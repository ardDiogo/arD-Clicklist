// Edge Function: nfce-proxy
// Busca a página pública de consulta da NFC-e (link do QR Code) no portal da SEFAZ.
// O navegador não consegue fazer isso direto por causa de CORS.
//
// Segurança:
//   * Exige usuário autenticado (JWT verificado pelo gateway do Supabase).
//   * Só acessa endereços *.gov.br (evita uso como proxy aberto / SSRF).
//   * Limite de tempo e de tamanho da resposta.
//
// Deploy pelo painel: Edge Functions → Deploy a new function → "nfce-proxy" → cole este arquivo.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const MAX_BYTES = 3 * 1024 * 1024
const TIMEOUT_MS = 15_000

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

function isAllowed(url: URL) {
  const host = url.hostname.toLowerCase()
  return (url.protocol === 'https:' || url.protocol === 'http:') && (host === 'gov.br' || host.endsWith('.gov.br'))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405)
  if (!req.headers.get('authorization')) return json({ error: 'Não autenticado' }, 401)

  let target: URL
  try {
    const body = await req.json()
    target = new URL(String(body?.url ?? ''))
  } catch {
    return json({ error: 'URL inválida' }, 400)
  }
  if (!isAllowed(target)) return json({ error: 'Somente portais da SEFAZ (gov.br) são permitidos' }, 400)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(target, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    })
    const finalUrl = new URL(res.url || target.toString())
    if (!isAllowed(finalUrl)) return json({ error: 'Redirecionamento para fora da SEFAZ bloqueado' }, 502)
    if (!res.ok) return json({ error: `A SEFAZ respondeu com erro ${res.status}` }, 502)

    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) return json({ error: 'Resposta muito grande' }, 502)

    // Vários portais ainda usam ISO-8859-1.
    const contentType = res.headers.get('content-type') ?? ''
    const sniff = new TextDecoder('latin1').decode(buf.slice(0, 2048))
    const charset =
      contentType.match(/charset=([\w-]+)/i)?.[1] ?? sniff.match(/charset=["']?([\w-]+)/i)?.[1] ?? 'utf-8'
    let html: string
    try {
      html = new TextDecoder(charset.toLowerCase()).decode(buf)
    } catch {
      html = new TextDecoder('utf-8').decode(buf)
    }
    return json({ html, finalUrl: finalUrl.toString() })
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return json({ error: aborted ? 'A SEFAZ demorou demais para responder' : 'Não foi possível acessar a SEFAZ' }, 504)
  } finally {
    clearTimeout(timer)
  }
})
