const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type'
    }
  });

export default async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const apiKey = Netlify.env.get('OPENAI_API_KEY');
    if (!apiKey) return json({ error: 'OPENAI_API_KEY is not configured on Netlify.' }, 503);

    const body = await req.json();
    const prompt = String(body?.prompt || '').trim();
    if (!prompt) return json({ error: 'Prompt is required.' }, 400);

    const reference = typeof body?.reference === 'string' && body.reference.startsWith('data:image/')
      ? body.reference
      : null;

    const input = [
      {
        role: 'user',
        content: reference
          ? [
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: reference, detail: 'high' }
            ]
          : [{ type: 'input_text', text: prompt }]
      }
    ];

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        input,
        tools: [
          {
            type: 'image_generation',
            model: 'gpt-image-2',
            size: '1024x1536',
            quality: 'high',
            output_format: 'png'
          }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return json(
        { error: data?.error?.message || `OpenAI request failed (${response.status}).` },
        response.status
      );
    }

    const call = Array.isArray(data?.output)
      ? data.output.find((item: any) => item?.type === 'image_generation_call')
      : null;

    if (!call?.result) return json({ error: 'OpenAI completed the request but returned no image.' }, 502);

    return json({ image: `data:image/png;base64,${call.result}` });
  } catch (error: any) {
    console.error('Character Studio generation error:', error);
    return json({ error: error?.message || 'Generation failed.' }, 500);
  }
};

export const config = { path: '/api/generate' };
