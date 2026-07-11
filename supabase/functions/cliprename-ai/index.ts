// ClipRename AI proxy — a Supabase / Lovable edge function.
//
// The desktop app posts { text, images[], json } here. This function adds the
// secret LOVABLE_API_KEY (auto-provided in Lovable Cloud edge functions) and
// forwards the request to the Lovable AI gateway, so AI usage is billed to YOUR
// Lovable balance and end users never need a key of their own.
//
// Deploy: see docs/lovable-ai-setup.md. The LOVABLE_API_KEY secret is available
// automatically when Lovable Cloud + Lovable AI are enabled on the project.

// Lovable AI gateway (OpenAI-compatible). Default model — adjust if Lovable
// changes the id (see your project's AI docs).
const GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions'
const MODEL = 'google/gemini-2.5-flash'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

interface Img {
  mime: string
  data: string
}

// @ts-ignore — Deno is the edge runtime; types aren't needed to build the app.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST')
    return new Response(JSON.stringify({ error: 'POST only' }), {
      status: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })

  // @ts-ignore — Deno global in the edge runtime.
  const key = Deno.env.get('LOVABLE_API_KEY')
  if (!key)
    return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })

  let body: { text?: string; images?: Img[]; json?: boolean }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
      status: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  // Build an OpenAI-style multimodal message: one text part + any image parts.
  const content: unknown[] = [{ type: 'text', text: body.text || '' }]
  for (const img of body.images || []) {
    content.push({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.data}` } })
  }

  const payload: Record<string, unknown> = {
    model: MODEL,
    messages: [{ role: 'user', content }]
  }
  if (body.json) payload.response_format = { type: 'json_object' }

  const r = await fetch(GATEWAY, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    return new Response(JSON.stringify({ error: detail || r.statusText }), {
      status: r.status, // forwards 402 (out of credit) so the app can show a clear message
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  const j = await r.json()
  const text = j?.choices?.[0]?.message?.content ?? ''
  return new Response(JSON.stringify({ text }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})
