# 🦎 Clube Guadix — Pátio Guadix

Plataforma de fidelidade do Pátio Guadix, localizado na Av. Juca Batista, Zona Sul de Porto Alegre.

## 📱 O que é

App/site progressivo (PWA) que permite:
- Cadastro de clientes com CPF, WhatsApp, e-mail, aniversário, CEP e profissão
- Acúmulo de pontos via cadastro de Nota Fiscal Eletrônica (NF-e / SEFAZ)
- Desbloqueio do mascote Guadi colecionável (a cada R$300 em compras)
- Participação em sorteios (ex: viagem ao Rio de Janeiro)
- Ofertas e notificações inteligentes por loja e horário

## 🏪 Lojas participantes

Bistek Supermercados · QuieroCafé · McDonald's · O Boticário · CacauShow ·
Farmácia São João · Natura · Casa Maria · Bellafast Salão · Momentus Tabacaria ·
Supertec Assistência · BigKey Chaveiro · Agropet Patas e Garras · Chuá Lavanderia · Loterias Caixa

## 📂 Estrutura do projeto

```
clube-guadix/
├── index.html      → App principal (cliente)
├── admin.html      → Painel administrativo
├── README.md       → Este arquivo
└── assets/
    ├── guadi.png   → Mascote oficial
    └── logo.png    → Logotipo Pátio Guadix
```

## 🚀 Como publicar

1. Fazer upload dos arquivos neste repositório
2. Ir em Settings → Pages → Source: main / root
3. Acessar: `https://seu-usuario.github.io/clube-guadix`

## 🔧 Stack técnica (MVP)

| Camada | Tecnologia | Custo |
|--------|-----------|-------|
| Frontend | HTML + CSS + JS puro | R$0 |
| Hospedagem | GitHub Pages | R$0 |
| Banco de dados | Supabase (PostgreSQL) | R$0 |
| NF-e | API pública SEFAZ | R$0 |
| Push notifications | OneSignal | R$0 |
| WhatsApp | Z-API | ~R$70/mês |
| Domínio | .com.br | ~R$40/ano |

## 📋 Dados coletados (LGPD)

- Nome completo
- CPF
- Data de nascimento
- E-mail
- WhatsApp
- CEP
- Profissão

Todos os dados são coletados com consentimento explícito e tratados conforme a Lei 13.709/2018 (LGPD).

## 📊 Métricas de consumo (uso interno)

- Ticket médio por cliente
- Frequência de visitas por mês
- Lojas mais visitadas
- Produtos mais comprados (via NF-e)
- Score de engajamento

---

Desenvolvido para o **Pátio Guadix** · Zona Sul · Porto Alegre · 2026
