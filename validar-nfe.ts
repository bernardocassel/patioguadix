import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Busca XML completo da nota na SEFAZ RS (dados completos: itens, emitente, horário)
async function buscarDadosSEFAZ(chave: string) {
  try {
    // Portal público SVRS RS — retorna HTML com dados da nota
    const url = `https://dfe-portal.svrs.rs.gov.br/Nfce/QrCodeNFCe?chQRCode=${chave}|100|1|000001|`
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' }
    })
    const html = await r.text()

    // Extrai valor total
    const valorMatch = html.match(/Valor\s+(?:a pagar|Total)[^:]*R\$[:\s]*([\d]+[,.][\d]{2})/i)
      || html.match(/R\$\s*([\d]+[,.][\d]{2})/)
    const valor = valorMatch ? parseFloat(valorMatch[1].replace('.','').replace(',','.')) : 0

    // Extrai CNPJ emitente
    const cnpjMatch = html.match(/CNPJ[:\s]*([\d]{2}\.[\d]{3}\.[\d]{3}\/[\d]{4}-[\d]{2})/)
    const cnpj = cnpjMatch ? cnpjMatch[1].replace(/\D/g,'') : chave.substring(6,20)

    // Extrai nome emitente
    const nomeMatch = html.match(/<b[^>]*>([^<]{5,80})<\/b>/)
    const emitente = nomeMatch ? nomeMatch[1].trim() : ''

    // Extrai data emissão
    const dataMatch = html.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/)
    const dataEmissao = dataMatch ? `${dataMatch[1]} ${dataMatch[2]}` : null

    // Extrai itens (produtos)
    const itens: any[] = []
    const itenMatches = html.matchAll(/class="[^"]*item[^"]*"[^>]*>.*?<\/tr>/gis)
    for (const m of itenMatches) {
      const text = m[0].replace(/<[^>]+>/g,' ').trim()
      if (text.length > 3) itens.push({ descricao: text.substring(0,100) })
    }

    return { valor, cnpj, emitente, dataEmissao, itens, html_raw: html.substring(0,2000) }
  } catch(e) {
    return { valor: 0, cnpj: chave.substring(6,20), emitente: '', dataEmissao: null, itens: [], html_raw: '' }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const body = await req.json()
    const { chave, cliente_id, valor: valorManual = 0 } = body

    const chaveNum = String(chave).replace(/\D/g,'').substring(0,44)
    if (chaveNum.length !== 44) {
      return new Response(JSON.stringify({ error: 'Chave deve ter 44 dígitos.' }),
        { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const modelo = chaveNum.substring(20,22)
    const numeroNota = parseInt(chaveNum.substring(25,34))
    const cuf = chaveNum.substring(0,2)
    const aamm = chaveNum.substring(2,6)
    const cnpjChave = chaveNum.substring(6,20)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SERVICE_ROLE_KEY')!
    )

    // Checa duplicata
    const { data: existing } = await supabase
      .from('notas_fiscais').select('id').eq('chave_nfe', chaveNum).maybeSingle()
    if (existing) {
      return new Response(JSON.stringify({ error: 'Nota fiscal já cadastrada.' }),
        { status: 409, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // Busca dados completos na SEFAZ
    const sefaz = await buscarDadosSEFAZ(chaveNum)

    // Valor: SEFAZ > manual > 0
    const valorFinal = sefaz.valor > 0 ? sefaz.valor : parseFloat(String(valorManual)) || 0
    if (valorFinal <= 0) {
      return new Response(
        JSON.stringify({ error: 'Informe o valor total da nota.', precisa_valor: true }),
        { status: 422, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    // CNPJ: SEFAZ > chave
    const cnpjFinal = sefaz.cnpj || cnpjChave

    // Busca loja pelo CNPJ
    const { data: loja } = await supabase
      .from('lojas').select('id, nome').eq('cnpj', cnpjFinal).maybeSingle()

    // Data emissão da chave: AAMM = posição 2-6
    const ano = '20' + aamm.substring(0,2)
    const mes = aamm.substring(2,4)
    const dataEmissaoISO = sefaz.dataEmissao
      ? new Date(sefaz.dataEmissao.replace(/(\d{2})\/(\d{2})\/(\d{4})/,'$3-$2-$1')).toISOString()
      : `${ano}-${mes}-01T00:00:00Z`

    const pontos = Math.floor(valorFinal)

    // Monta JSON completo da nota para o campo sefaz_response
    const dadosCompletos = {
      modelo: modelo === '65' ? 'NFC-e' : 'NF-e',
      numero_nota: numeroNota,
      cnpj_emitente: cnpjFinal,
      nome_emitente: sefaz.emitente || loja?.nome || '',
      estado: cuf === '43' ? 'RS' : cuf,
      data_emissao: dataEmissaoISO,
      itens: sefaz.itens,
      valor_total: valorFinal,
      consultado_em: new Date().toISOString(),
      portal: 'SVRS-RS'
    }

    // Salva nota com todos os dados
    const { data: nota, error: notaError } = await supabase
      .from('notas_fiscais')
      .insert({
        cliente_id,
        loja_id: loja?.id || null,
        chave_nfe: chaveNum,
        valor_total: valorFinal,
        data_emissao: dataEmissaoISO,
        pontos_gerados: pontos,
        status: 'aprovada',           // ← enum correto
        itens: sefaz.itens.length > 0 ? sefaz.itens : null,
        guadi_desbloqueado: valorFinal >= 300,
        sefaz_response: dadosCompletos
      })
      .select().single()

    if (notaError) throw notaError

    // Atualiza pontos do cliente
    const { data: cli } = await supabase
      .from('clientes').select('pontos_total').eq('id', cliente_id).single()
    const novoTotal = (cli?.pontos_total || 0) + pontos
    await supabase.from('clientes').update({ pontos_total: novoTotal }).eq('id', cliente_id)

    // Histórico de pontos
    await supabase.from('pontos_historico').insert({
      cliente_id,
      tipo: 'credito',
      pontos,
      descricao: `${dadosCompletos.modelo} #${numeroNota} — ${loja?.nome || sefaz.emitente || 'Loja parceira'} — R$${valorFinal.toFixed(2)}`
    })

    // Desbloqueia Guadi se >= R$300
    let guadi_desbloqueado = false
    if (valorFinal >= 300) {
      const { data: g } = await supabase
        .from('clientes_guadis').select('guadi_id')
        .eq('cliente_id', cliente_id)
        .order('desbloqueado_em', { ascending: false })
        .limit(1)

      // clientes_guadis tem: id, cliente_id, guadi_id, nota_id, desbloqueado_em
      const { error: ge } = await supabase.from('clientes_guadis').insert({
        cliente_id,
        nota_id: nota.id          // ← nome correto da coluna
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
      loja: loja?.nome || sefaz.emitente || null,
      cnpj: cnpjFinal,
      data_emissao: dataEmissaoISO,
      itens_count: sefaz.itens.length,
      modelo: dadosCompletos.modelo,
      guadi_desbloqueado,
      pontos_total: novoTotal
    }), { headers: { ...cors, 'Content-Type': 'application/json' } })

  } catch(err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } }
    )
  }
})
