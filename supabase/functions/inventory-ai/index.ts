// Edge Function: inventory-ai
// Analisa as FOTOS de um ambiente (despensa, geladeira…) com o Gemini e devolve
// os produtos identificados, quantidades estimadas e grau de confiança.
// NÃO altera o estoque: o app grava como rascunho e o usuário revisa e confirma.
//
// Secrets: GEMINI_API_KEY (obrigatório), GEMINI_MODEL (opcional; padrão gemini-2.5-flash, com alternativas automáticas).
// Publicação: deixe "Verify JWT" DESLIGADO — a função valida a sessão por conta própria
// (o verificador do painel não aceita as chaves de assinatura novas do Supabase).
// Segurança: fotos, conferência e catálogo são lidos com o token do PRÓPRIO usuário (RLS).
//
// Deploy pelo painel: Edge Functions → Deploy a new function → "inventory-ai" → cole este arquivo.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_PHOTOS = 8

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    detections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          brand: { type: 'STRING', nullable: true },
          details: { type: 'STRING', nullable: true },
          quantity: { type: 'INTEGER', nullable: true },
          confidence: { type: 'NUMBER' },
          partially_hidden: { type: 'BOOLEAN' },
          photos: { type: 'ARRAY', items: { type: 'INTEGER' } },
          catalog_ref: { type: 'INTEGER', nullable: true },
        },
        required: ['name', 'confidence', 'partially_hidden', 'photos'],
      },
    },
  },
  required: ['detections'],
}

function buildPrompt(locationName: string | null, catalog: string[], photoCount: number) {
  return `Você confere o estoque de uma casa brasileira a partir de ${photoCount} foto(s)${
    locationName ? ` do ambiente "${locationName}"` : ''
  }. As fotos estão numeradas de 1 a ${photoCount}, na ordem enviada.

Catálogo de produtos que a família controla (número | produto):
${catalog.length ? catalog.join('\n') : '(vazio)'}

Tarefa: liste os produtos de mercado visíveis (alimentos, bebidas, higiene, limpeza etc.).
Regras OBRIGATÓRIAS:
- Não invente produtos nem quantidades. Liste apenas o que realmente aparece.
- quantity = número de embalagens visíveis. Se não for possível contar com segurança, use null.
- Se o mesmo produto aparece em mais de uma foto, verifique se é o MESMO objeto (fotos sobrepostas)
  antes de somar. Na dúvida, não some e reduza a confiança.
- partially_hidden = true se o produto está parcialmente coberto, cortado ou atrás de outros.
- confidence de 0 a 1: quão certo você está do produto E da quantidade.
- catalog_ref = número do catálogo SOMENTE se marca e tipo correspondem claramente; senão null.
  Produtos parecidos de marcas ou versões diferentes NÃO são o mesmo item.
- name: tipo do produto em português (ex.: "Ketchup", "Sabão em pó"). brand: marca legível ou null.
  details: tamanho/versão legível (ex.: "380 g", "zero açúcar") ou null.
- photos: números das fotos onde o produto aparece.
- Se uma foto não mostrar produtos, apenas ignore-a.`
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

// Chama o Gemini tentando modelos alternativos se o configurado não existir mais.
// Devolve o texto JSON gerado ou um erro amigável com o motivo informado pelo Google.
async function callGemini(apiKey: string, models: string[], body: unknown): Promise<{ text: string; model: string } | { error: string; status: number }> {
  let last: { error: string; status: number } = { error: 'O serviço de IA não respondeu. Tente novamente em instantes.', status: 502 }
  for (const model of models) {
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
      continue
    }
    if (/API key not valid|API_KEY_INVALID/i.test(msg)) return { error: 'Chave do Gemini inválida. Confira o secret GEMINI_API_KEY no Supabase.', status: 502 }
    if (res.status === 403) return { error: `A chave do Gemini não tem permissão: ${msg.slice(0, 160)}`, status: 502 }
    if (res.status === 429) return { error: 'Limite de uso do Gemini atingido. Aguarde alguns minutos e tente de novo.', status: 429 }
    if (/location is not supported/i.test(msg)) return { error: 'O Gemini não está disponível na região do servidor do Supabase.', status: 502 }
    return { error: `O Gemini recusou a análise (${res.status}): ${msg.slice(0, 200) || 'sem detalhes'}`, status: 502 }
  }
  return last
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)
  const auth = req.headers.get('authorization')
  if (!auth) return json({ error: 'Não autenticado' }, 401)

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return json({ error: 'Análise por fotos ainda não configurada (falta GEMINI_API_KEY).' }, 503)
  const models = [
    ...new Set([Deno.env.get('GEMINI_MODEL'), 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash'].filter((m): m is string => !!m)),
  ]

  let scanId: string
  try {
    scanId = String((await req.json())?.scan_id ?? '')
  } catch {
    return json({ error: 'Requisição inválida' }, 400)
  }
  if (!/^[0-9a-f-]{36}$/i.test(scanId)) return json({ error: 'Conferência inválida' }, 400)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, (Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY'))!, {
    global: { headers: { Authorization: auth } },
  })
  // Valida a sessão aqui (funciona com as chaves novas do Supabase; deixe "Verify JWT" desligado).
  const { data: userData, error: userErr } = await supabase.auth.getUser(auth.replace(/^Bearer\s+/i, ''))
  if (userErr || !userData?.user) return json({ error: 'Sessão inválida. Entre novamente no app.' }, 401)

  const { data: scan } = await supabase
    .from('inventory_scans')
    .select('id, household_id, location_id, status')
    .eq('id', scanId)
    .maybeSingle()
  if (!scan) return json({ error: 'Conferência não encontrada' }, 404)
  if (scan.status !== 'draft') return json({ error: 'Esta conferência já foi finalizada' }, 409)

  const [{ data: files }, { data: stock }, { data: location }] = await Promise.all([
    supabase.from('inventory_scan_files').select('position, storage_path, mime_type').eq('scan_id', scanId).order('position'),
    supabase
      .from('household_stock')
      .select('id, product_name, brand_name, presentation, package_size, unit, location_id')
      .eq('household_id', scan.household_id),
    scan.location_id
      ? supabase.from('locations').select('name').eq('id', scan.location_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  if (!files?.length) return json({ error: 'Nenhuma foto enviada' }, 400)

  // Produtos do ambiente primeiro (o modelo tende a considerar o início da lista).
  const products = [...(stock ?? [])].sort(
    (a, b) => Number(b.location_id === scan.location_id) - Number(a.location_id === scan.location_id),
  ).slice(0, 300)
  const catalog = products.map((p, i) =>
    `${i + 1} | ${[p.product_name, p.brand_name, p.presentation, p.package_size ? `${p.package_size} ${p.unit}` : null]
      .filter(Boolean)
      .join(' · ')}`,
  )

  const parts: Record<string, unknown>[] = []
  for (const f of files.slice(0, MAX_PHOTOS)) {
    const { data: blob } = await supabase.storage.from('inventory-photos').download(f.storage_path)
    if (!blob) return json({ error: `Não foi possível ler a foto ${f.position}` }, 404)
    parts.push({ inline_data: { mime_type: f.mime_type, data: toBase64(new Uint8Array(await blob.arrayBuffer())) } })
  }
  parts.push({ text: buildPrompt(location?.name ?? null, catalog, parts.length) })

  const result = await callGemini(apiKey, models, {
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
    })
  if ('error' in result) return json({ error: result.error }, result.status)
  const model = result.model

  let raw: { detections?: Record<string, unknown>[] }
  try {
    raw = JSON.parse(result.text)
  } catch {
    return json({ error: 'Não foi possível interpretar a resposta da IA' }, 502)
  }

  const photoCount = parts.length - 1
  const detections = (raw.detections ?? [])
    .map((d) => {
      const ref = typeof d.catalog_ref === 'number' ? d.catalog_ref : null
      const product = ref && ref >= 1 && ref <= products.length ? products[ref - 1] : null
      const qty = typeof d.quantity === 'number' && Number.isFinite(d.quantity) && d.quantity >= 0 ? Math.round(d.quantity) : null
      const conf = typeof d.confidence === 'number' ? Math.min(1, Math.max(0, d.confidence)) : 0
      return {
        name: typeof d.name === 'string' ? d.name.trim().slice(0, 160) : '',
        brand: typeof d.brand === 'string' && d.brand.trim() ? d.brand.trim().slice(0, 80) : null,
        details: typeof d.details === 'string' && d.details.trim() ? d.details.trim().slice(0, 200) : null,
        quantity: qty,
        confidence: Math.round(conf * 100) / 100,
        partially_hidden: d.partially_hidden === true,
        photos: Array.isArray(d.photos)
          ? [...new Set(d.photos.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= photoCount))]
          : [],
        product_id: product?.id ?? null,
      }
    })
    .filter((d) => d.name)
    .slice(0, 200)

  return json({ detections, model })
})
