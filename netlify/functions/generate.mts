export default async (req: Request) => {
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'content-type': 'application/json' } });
  try {
    const apiKey = Netlify.env.get('OPENAI_API_KEY');
    if (!apiKey) return new Response(JSON.stringify({ error: 'OPENAI_API_KEY is not configured.' }), { status: 503, headers: { 'content-type': 'application/json' } });
    const body = await req.json();
    const prompt = String(body?.prompt || '').trim();
    if (!prompt) return new Response(JSON.stringify({ error: 'Prompt is required.' }), { status: 400, headers: { 'content-type': 'application/json' } });
    const reference = typeof body?.reference === 'string' ? body.reference : null;
    const input = reference
      ? [{ type: 'message', role: 'user', content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: reference, detail: 'high' }
        ] }]
      : [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] }];
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        input,
        tools: [{ type: 'image_generation', model: 'gpt-image-2', size: '1024x1536', quality: 'high' }]
      })
    });
    const data = await r.json();
    if (!r.ok) return new Response(JSON.stringify({ error: data?.error?.message || 'OpenAI request failed.' }), { status: r.status, headers: { 'content-type': 'application/json' } });
    const call = Array.isArray(data?.output) ? data.output.find((x: any) => x?.type === 'image_generation_call') : null;
    if (!call?.result) return new Response(JSON.stringify({ error: 'No image was returned.' }), { status: 502, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ image: `data:image/png;base64,${call.result}` }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'Generation failed.' }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
};

export const config = { path: '/api/generate' };
