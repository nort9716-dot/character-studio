const ALLOWED_ORIGINS = new Set([
  'https://character-studio-nort9716.netlify.app',
  'https://main--character-studio-nort9716.netlify.app'
]);
const MAX_PROMPT = 30000;
const MAX_REFERENCE_BYTES = 12_000_000;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const rateMap = new Map<string, { count: number; reset: number }>();

const json = (body: unknown, status = 200, origin = '') => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    ...(ALLOWED_ORIGINS.has(origin) ? {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type'
    } : {})
  }
});

function clientKey(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for') || '';
  return (forwarded.split(',')[0] || req.headers.get('x-nf-client-connection-ip') || 'unknown').trim();
}

function allowedRequest(req: Request) {
  const origin = req.headers.get('origin') || '';
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function rateLimited(key: string) {
  const now = Date.now();
  const old = rateMap.get(key);
  if (!old || now >= old.reset) {
    rateMap.set(key, { count: 1, reset: now + WINDOW_MS });
    return false;
  }
  if (old.count >= MAX_REQUESTS_PER_WINDOW) return true;
  old.count++;
  return false;
}

function extractText(data: any) {
  return Array.isArray(data?.output)
    ? data.output.filter((x: any) => x?.type === 'message').flatMap((x: any) => x?.content || []).map((x: any) => x?.text || '').join('')
    : '';
}

function parseJson(text: string) {
  try { return JSON.parse(text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()); }
  catch { return null; }
}

async function openAIText(apiKey: string, system: string, prompt: string) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-5.6-luna',
      input: [
        { role: 'system', content: [{ type: 'input_text', text: system }] },
        { role: 'user', content: [{ type: 'input_text', text: prompt }] }
      ]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI request failed (${response.status}).`);
  const text = extractText(data);
  if (!text) throw new Error('No text result returned.');
  return text;
}

export default async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  if (req.method === 'OPTIONS') {
    if (!allowedRequest(req)) return json({ error: 'Forbidden origin.' }, 403, origin);
    return json({ ok: true }, 200, origin);
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);
  if (!allowedRequest(req)) return json({ error: 'Forbidden origin.' }, 403, origin);
  if (rateLimited(clientKey(req))) return json({ error: 'Too many requests. Please wait a minute and try again.' }, 429, origin);

  try {
    const apiKey = Netlify.env.get('OPENAI_API_KEY');
    if (!apiKey) return json({ error: 'OPENAI_API_KEY is not configured on Netlify.' }, 503, origin);

    const body = await req.json();
    const prompt = String(body?.prompt || '').trim();
    if (!prompt) return json({ error: 'Prompt is required.' }, 400, origin);
    if (prompt.length > MAX_PROMPT) return json({ error: 'Prompt is too large.' }, 413, origin);

    if (body?.mode === 'dialogue') {
      const system = `You are the Character Studio Dialogue & Language Engine. Handle Tabrizi Azerbaijani carefully. The user may want Azerbaijani spoken in Tabriz written with Persian script, with Persian-script diacritics added only to clarify pronunciation; optionally provide a Latin phonetic transcription of the SAME spoken words, not an English translation; optionally provide a faithful English translation. Never replace a requested phonetic transcription with translation. Preserve colloquial Tabrizi pronunciation, tone, intent and meaning. Do not invent a different dialect. Return clean JSON with keys: persian_script, latin_phonetic, english_translation. If an output is not requested, return an empty string for that key.`;
      const text = await openAIText(apiKey, system, prompt);
      return json({ dialogue: parseJson(text) || { persian_script: text, latin_phonetic: '', english_translation: '' } }, 200, origin);
    }

    if (body?.mode === 'diagnostic') {
      const system = `You are the Character Studio Smart Troubleshooter. Diagnose failed or partially failed creative generations. Ask only the minimum useful questions needed to isolate the failure. Use the user's answers to distinguish prompt conflict, identity/reference conflict, anatomy/pose conflict, style/model incompatibility, unsupported wording, image/video continuity problems, dialogue/language problems, composition/camera conflicts, safety/policy rejection, API/credits/backend errors, or temporary generator failures. Do not blame the user. Return JSON only with keys: diagnosis, confidence, next_question, question_options, likely_causes, immediate_fix, repaired_prompt, ask_more. question_options must be an array of concise choices. If enough information exists, ask_more=false and provide a repaired_prompt; otherwise ask_more=true and provide exactly one next_question. Preserve the user's intent and identity constraints.`;
      const text = await openAIText(apiKey, system, prompt);
      const parsed = parseJson(text);
      if (!parsed) return json({ error: 'Diagnostic engine returned invalid structured output.' }, 502, origin);
      return json({ diagnostic: parsed }, 200, origin);
    }

    const reference = typeof body?.reference === 'string' && body.reference.startsWith('data:image/') && body.reference.length <= MAX_REFERENCE_BYTES ? body.reference : null;
    const input = [{ role: 'user', content: reference ? [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: reference, detail: 'high' }] : [{ type: 'input_text', text: prompt }] }];
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.6-luna', input, tools: [{ type: 'image_generation', model: 'gpt-image-2', size: '1024x1536', quality: 'high', output_format: 'png' }] })
    });
    const data = await response.json();
    if (!response.ok) return json({ error: data?.error?.message || `OpenAI request failed (${response.status}).` }, response.status, origin);
    const call = Array.isArray(data?.output) ? data.output.find((item: any) => item?.type === 'image_generation_call') : null;
    if (!call?.result) return json({ error: 'OpenAI completed the request but returned no image.' }, 502, origin);
    return json({ image: `data:image/png;base64,${call.result}` }, 200, origin);
  } catch (error: any) {
    console.error('Character Studio generation error:', error?.message || 'unknown');
    return json({ error: error?.message || 'Generation failed.' }, 500, origin);
  }
};

export const config = { path: '/api/generate' };
