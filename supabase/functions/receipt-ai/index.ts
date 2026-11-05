// Edge Function: receipt-ai
// Lê a FOTO de um comprovante com o Gemini e devolve os dados estruturados.
// NÃO grava nada no estoque: o app cria um rascunho e o usuário revisa e confirma.
//
// Secrets necessários (Edge Functions → Secrets):
//   GEMINI_API_KEY   chave do Google AI Studio (https://aistudio.google.com/apikey)
//   GEMINI_MODEL     opcional (padrão: gemini-3.8-flash; se indisponível, tenta gemini-flash-latest)
// SUPABASE_URL e SUPABASE_ANON_KEY já são fornecidos automaticamente.
//
// Publicação: deixe "Verify JWT" DESLIGADO — a função valida a sessão por conta própria
// (o verificador do painel não aceita as chaves de assinatura novas do Supabase).
// Segurança: o arquivo é lido com o token do PRÓPRIO usuário, então o RLS do
// Storage garante que só membros da família acessam a imagem.
//
// Deploy pelo painel: Edge Functions → Deploy a new function → "receipt-ai" → cole este arquivo.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const PROMPT = `Você lê cupons fiscais brasileiros (NFC-e / cupom de supermercado).
Extraia SOMENTE o que está impresso na imagem. Regras:
- Não invente produtos, quantidades ou valores. Se algo estiver ilegível, use null.
- Uma entrada por linha de produto, na ordem do cupom. Ignore linhas de troco, pagamento e tributos.
- description: exatamente como impresso (pode estar abreviado).
- quantity: número (use ponto decimal). unit: UN, KG, L, PCT etc.
- unit_price e total: valores da linha. discount: desconto da linha, se houver, senão 0.
- ean: código de barras de 8 a 14 dígitos se aparecer na linha, senão null.
- purchased_at: data/hora da emissão em ISO 8601 com fuso -03:00, se visível.
- access_key: chave de acesso de 44 dígitos (somente dígitos), se visível.
- store_cnpj: somente dígitos.
- unreadable: true se a imagem não for um comprovante ou estiver ilegível.`

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    unreadable: { type: 'BOOLEAN' },
    store_name: { type: 'STRING', nullable: true },
    store_cnpj: { type: 'STRING', nullable: true },
    purchased_at: { type: 'STRING', nullable: true },
    access_key: { type: 'STRING', nullable: true },
    total: { type: 'NUMBER', nullable: true },
    discount: { type: 'NUMBER', nullable: true },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          description: { type: 'STRING' },
          ean: { type: 'STRING', nullable: true },
          quantity: { type: 'NUMBER', nullable: true },
          unit: { type: 'STRING', nullable: true },
          unit_price: { type: 'NUMBER', nullable: true },
          discount: { type: 'NUMBER', nullable: true },
          total: { type: 'NUMBER', nullable: true },
        },
        required: ['description'],
      },
    },
  },
  required: ['unreadable', 'items'],
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const digits = (v: unknown) => (typeof v === 'string' ? v.replace(/\D/g, '') : '')

// Chama o Gemini tentando modelos alternativos se o configurado não existir mais.
// Devolve o texto JSON gerado ou um erro amigável com o motivo informado pelo Google.
async function callGemini(apiKey: string, models: string[], body: unknown): Promise<{ text: string; model: string } | { error: string; status: number }> {
  let last: { error: string; status: number } = { error: 'O serviço de IA não respondeu. Tente novamente em instantes.', status: 502 }
  for (const model of models) {
   // Sobrecarga (503/500) ou limite (429): espera um pouco e tenta de novo; depois passa ao próximo modelo.
   for (let attempt = 1; attempt <= 2; attempt++) {
    let res: Response
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
      })
    } catch {
      last = { error: 'Não foi possível conectar ao Gemini. Tente novamente em instantes.', status: 502 }
      continue
    }
    if (res.ok) {
      const out = await res.json().catch(() => null)
      const text = out?.candidates?.[0]?.content?.parts?.[0]?.text
      if (typeof text === 'string') return { text, model }
      const reason = out?.promptFeedback?.blockReason ?? out?.candidates?.[0]?.finishReason ?? 'resposta vazia'
      return { error: `O Gemini não devolveu resultado (${reason}). Tente outra foto.`, status: 502 }
    }
    const raw = await res.text()
    console.error('Gemini error', model, res.status, raw)
    let msg = ''
    try {
      msg = JSON.parse(raw)?.error?.message ?? ''
    } catch {
      msg = raw.slice(0, 200)
    }
    // Modelo inexistente/indisponível: tenta o próximo da lista.
    if (res.status === 404 || /not found|not supported for generateContent|is not available/i.test(msg)) {
      last = { error: `Modelo do Gemini indisponível (${model}).`, status: 502 }
      break
    }
    if (res.status === 503 || res.status === 500 || res.status === 429 || /high demand|overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(msg)) {
      last = {
        error: 'O Gemini está sobrecarregado no momento. Aguarde alguns minutos e toque em "Analisar" de novo.',
        status: 503,
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2000))
      continue
    }
    if (/API key not valid|API_KEY_INVALID/i.test(msg)) return { error: 'Chave do Gemini inválida. Confira o secret GEMINI_API_KEY no Supabase.', status: 502 }
    if (res.status === 403) return { error: `A chave do Gemini não tem permissão: ${msg.slice(0, 160)}`, status: 502 }
    if (/location is not supported/i.test(msg)) return { error: 'O Gemini não está disponível na região do servidor do Supabase.', status: 502 }
    return { error: `O Gemini recusou a análise (${res.status}): ${msg.slice(0, 200) || 'sem detalhes'}`, status: 502 }
   }
  }
  return last
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)

  const auth = req.headers.get('authorization')
  if (!auth) return json({ error: 'Não autenticado' }, 401)

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return json({ error: 'Leitura por foto ainda não configurada (falta GEMINI_API_KEY).' }, 503)
  const models = [
    ...new Set([Deno.env.get('GEMINI_MODEL'), 'gemini-3.8-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest'].filter((m): m is string => !!m)),
  ]

  let fileId: string
  try {
    fileId = String((await req.json())?.file_id ?? '')
  } catch {
    return json({ error: 'Requisição inválida' }, 400)
  }
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return json({ error: 'Arquivo inválido' }, 400)

  // Cliente com o token do usuário: RLS decide o que ele pode ler.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, (Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY'))!, {
    global: { headers: { Authorization: auth } },
  })
  // Valida a sessão aqui (funciona com as chaves novas do Supabase; deixe "Verify JWT" desligado).
  const { data: userData, error: userErr } = await supabase.auth.getUser(auth.replace(/^Bearer\s+/i, ''))
  if (userErr || !userData?.user) return json({ error: 'Sessão inválida. Entre novamente no app.' }, 401)

  const { data: file, error: fileErr } = await supabase
    .from('purchase_files')
    .select('storage_path, mime_type, size_bytes')
    .eq('id', fileId)
    .maybeSingle()
  if (fileErr || !file) return json({ error: 'Arquivo não encontrado' }, 404)
  if (!file.mime_type.startsWith('image/')) return json({ error: 'A leitura por IA aceita apenas imagens' }, 400)

  const { data: blob, error: dlErr } = await supabase.storage.from('receipts').download(file.storage_path)
  if (dlErr || !blob) return json({ error: 'Não foi possível ler a imagem' }, 404)

  const bytes = new Uint8Array(await blob.arrayBuffer())
  const result = await callGemini(apiKey, models, {
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: file.mime_type, data: toBase64(bytes) } }, { text: PROMPT }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
    })
  if ('error' in result) return json({ error: result.error }, result.status)
  const model = result.model

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(result.text)
  } catch {
    return json({ error: 'Não foi possível interpretar a resposta da IA' }, 502)
  }

  if (parsed.unreadable === true) {
    return json({ error: 'Não consegui ler este comprovante. Tente uma foto mais nítida, reta e bem iluminada.' }, 422)
  }

  const items = (Array.isArray(parsed.items) ? parsed.items : [])
    .map((raw) => {
      const i = raw as Record<string, unknown>
      const ean = digits(i.ean)
      return {
        description: typeof i.description === 'string' ? i.description.trim().slice(0, 200) : '',
        ean: ean.length >= 8 && ean.length <= 14 ? ean : null,
        quantity: num(i.quantity) ?? 1,
        unit: typeof i.unit === 'string' ? i.unit.trim().toUpperCase().slice(0, 10) : null,
        unit_price: num(i.unit_price),
        discount: num(i.discount) ?? 0,
        total: num(i.total),
      }
    })
    .filter((i) => i.description)

  if (items.length === 0) return json({ error: 'Nenhum produto identificado na foto.' }, 422)

  const key = digits(parsed.access_key)
  const cnpj = digits(parsed.store_cnpj)
  return json({
    store_name: typeof parsed.store_name === 'string' ? parsed.store_name.slice(0, 160) : null,
    store_cnpj: cnpj.length === 14 ? cnpj : null,
    purchased_at: typeof parsed.purchased_at === 'string' && !Number.isNaN(Date.parse(parsed.purchased_at)) ? parsed.purchased_at : null,
    access_key: key.length === 44 ? key : null,
    total: num(parsed.total),
    discount: num(parsed.discount),
    items,
    model,
  })
})
