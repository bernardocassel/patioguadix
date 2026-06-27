import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function buscarValorSEFAZ(chave: string): Promise<number> {
  const cuf = chave.substring(0, 2)
  const urls: Record<string, string> = {
    '43': 'https://dfe-portal.svrs.rs.gov.br/Nfce/ConsultaPublica',
    '35': 'https://www.nfce.fazenda.sp.gov.br/consulta',
    '41': 'https://www.nfce.info.pr.gov.br/nfce/consulta',
    '42': 'https://sat.sef.sc.gov.br/nfce/consulta',
    '33': 'https://www.nfce.fazenda.rj.gov.br/consulta',
    '31': 'https://hnfe.fazenda.mg.gov.br/nfce/consultaNFCe',
  }
  const url = urls[cuf] || urls['43']
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
      body: `chaveNFe=${chave}&tipoConteudo=R`
    })
    const html = await r.text()
    const patterns = [
      /Valor a pagar R\$[:\s]*([\d]+[,.][\d]{2})/i,
      /Total R\$[:\s]*([\d]+[,.][\d]{2})/i,
      /vNF=([\d]+\.[\d]{2})/,
      /R\$\s*([\d\.]+,[\d]{2})/,
    ]
    for (const p of patterns) {
      const m = html.match(p)
      if (m) return parseFloat(m[1].replace('.','').replace(',','.'))
    }
  } catch (_) {}
  return 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const body = await req.json()
    const { chave, cliente_id, valor: valorHint = 0 } = body

    // Limpa e valida chave
    const chaveNum = String(chave).replace(/\D/g, '').substring(0, 44)
    if (chaveNum.length !== 44) {
      return new Response(JSON.stringify({ error: 'Chave deve ter 44 dígitos.' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const modelo = chaveNum.substring(20, 22)
    const cnpjEmitente = chaveNum.substring(6, 20)
    const numeroNota = parseInt(chaveNum.substring(25, 34))

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SERVICE_ROLE_KEY')!
    )

    // ── Checa duplicata usando nome correto: chave_nfe ──
    const { data: existing } = await supabase
      .from('notas_fiscais')
      .select('id')
      .eq('chave_nfe', chaveNum)
      .maybeSingle()

    if (existing) {
      return new Response(JSON.stringify({ error: 'Nota fiscal já cadastrada.' }),
        { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // ── Busca valor na SEFAZ automaticamente ──
    let valorFinal = await buscarValorSEFAZ(chaveNum)

    // Se não veio da SEFAZ, usa o hint da URL do QR Code ou o manual
    if (valorFinal === 0) valorFinal = parseFloat(String(valorHint)) || 0

    // Se ainda zero, pede pro usuário informar
    if (valorFinal === 0) {
      return new Response(
        JSON.stringify({ error: 'Não foi possível obter o valor automaticamente. Informe o valor da nota.', precisa_valor: true }),
        { status: 422, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    const pontos = Math.floor(valorFinal)

    // ── Busca loja pelo CNPJ ──
    const { data: loja } = await supabase
      .from('lojas')
      .select('id, nome')
      .eq('cnpj', cnpjEmitente)
      .maybeSingle()

    // ── Calcula se vai desbloquear Guadi ──
    let guadi_desbloqueado = false
    let proximoGuadi = 0
    if (valorFinal >= 300) {
      const { data: guadisAtuais } = await supabase
        .from('clientes_guadis')
        .select('numero_guadi')
        .eq('cliente_id', cliente_id)
        .order('numero_guadi', { ascending: false })
        .limit(1)
      proximoGuadi = (guadisAtuais?.[0]?.numero_guadi || 0) + 1
    }

    // ── Salva nota com nomes corretos das colunas ──
    const { data: nota, error: notaError } = await supabase
      .from('notas_fiscais')
      .insert({
        cliente_id,
        loja_id: loja?.id || null,
        chave_nfe: chaveNum,           // ← nome correto
        valor_total: valorFinal,       // ← nome correto
        data_emissao: new Date().toISOString(),
        pontos_gerados: pontos,
        guadi_desbloqueado: valorFinal >= 300 && proximoGuadi <= 10,
        status: 'aprovado',
        sefaz_response: { modelo, numero_nota: numeroNota, consultado_em: new Date().toISOString() }
      })
      .select()
      .single()

    if (notaError) throw notaError

    // ── Atualiza pontos do cliente ──
    const { data: clienteAtual } = await supabase
      .from('clientes')
      .select('pontos_total')
      .eq('id', cliente_id)
      .single()

    const novoTotal = (clienteAtual?.pontos_total || 0) + pontos
    await supabase.from('clientes').update({ pontos_total: novoTotal }).eq('id', cliente_id)

    // ── Histórico de pontos ──
    await supabase.from('pontos_historico').insert({
      cliente_id,
      tipo: 'credito',
      pontos,
      descricao: `${modelo === '65' ? 'NFC-e' : 'NF-e'} #${numeroNota} — ${loja?.nome || 'Loja parceira'}`
    })

    // ── Desbloqueia Guadi se valor >= R$300 ──
    if (valorFinal >= 300 && proximoGuadi >= 1 && proximoGuadi <= 10) {
      const { error: ge } = await supabase.from('clientes_guadis').insert({
        cliente_id,
        numero_guadi: proximoGuadi,
        nota_fiscal_id: nota.id
      })
      if (!ge) {
        guadi_desbloqueado = true
        await supabase.from('sorteio_participantes').insert({
          cliente_id,
          numero_sorte: Math.floor(Math.random() * 900000) + 100000
        })
      }
    }

    return new Response(JSON.stringify({
      success: true,
      pontos,
      valor: valorFinal,
      loja: loja?.nome || null,
      modelo: modelo === '65' ? 'NFC-e' : 'NF-e',
      guadi_desbloqueado,
      pontos_total: novoTotal
    }), { headers: { ...cors, 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    )
  }
})
