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
function allowedRequest(req: Request) { const origin = req.headers.get('origin') || ''; return !origin || ALLOWED_ORIGINS.has(origin); }
function rateLimited(key: string) {
  const now = Date.now(); const old = rateMap.get(key);
  if (!old || now >= old.reset) { rateMap.set(key, { count: 1, reset: now + WINDOW_MS }); return false; }
  if (old.count >= MAX_REQUESTS_PER_WINDOW) return true; old.count++; return false;
}
function extractText(data: any) {
  return Array.isArray(data?.output) ? data.output.filter((x: any) => x?.type === 'message').flatMap((x: any) => x?.content || []).map((x: any) => x?.text || '').join('') : '';
}
function parseJson(text: string) {
  try { return JSON.parse(text.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()); } catch { return null; }
}

async function openAIText(apiKey: string, system: string, prompt: string, reference: string | null = null) {
  const content: any[] = [{ type: 'input_text', text: prompt }];
  if (reference) content.push({ type: 'input_image', image_url: reference, detail: 'high' });
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5.6-luna', input: [
      { role: 'system', content: [{ type: 'input_text', text: system }] },
      { role: 'user', content }
    ] })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI request failed (${response.status}).`);
  const text = extractText(data); if (!text) throw new Error('No text result returned.'); return text;
}

const DIRECTOR_SYSTEM = `You are the Autonomous AI Director inside Character Studio. Turn one creative request into a production-ready package. Make creative decisions autonomously unless essential information is genuinely missing. Preserve immutable identity/reference rules. Character, Location, Outfit and Prop are independent roles and must never be merged or swapped. If an Original Reference image is supplied, treat it as the identity authority. Do not slim, reshape, age, de-age, replace or redesign the character. Do not invent dialogue. Extract only dialogue actually present in the user's main request. Return JSON only with exactly these keys: project, story, storyboard, shots, dialogue, element_mapping, continuity, seedance_prompt. project/story/storyboard/continuity are strings. shots is an array of objects with keys shot, scene, action, camera, lighting, duration, prompt. dialogue is an array of objects with keys speaker, line, language. element_mapping is an array of objects with keys element, role, rule. seedance_prompt is one complete copy-ready Seedance 2.5 video prompt. The seedance prompt must explicitly preserve Element roles, reference identity, spatial continuity, motion, camera, lighting, dialogue synchronization and negative constraints. If there is no dialogue, return an empty dialogue array. Never return markdown fences.`;

const MANUAL_SYSTEM = `You are a professional creative-production engine inside Character Studio. Execute the requested manual engine for the user's creative request. Preserve identity/reference constraints and keep Character, Location, Outfit and Prop roles separate. Make useful decisions rather than returning generic instructions. Return JSON only with keys: engine, result, prompts, next_steps. result is a concise but substantive production output. prompts is an array of copy-ready prompts when applicable. next_steps is an array. Never return markdown fences.`;

export default async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  if (req.method === 'OPTIONS') { if (!allowedRequest(req)) return json({ error: 'Forbidden origin.' }, 403, origin); return json({ ok: true }, 200, origin); }
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
      const system = `You are the Character Studio Dialogue & Language Engine. Handle Tabrizi Azerbaijani carefully. The user may want Azerbaijani spoken in Tabriz written with Persian script, with Persian-script diacritics only when useful; optionally provide a Latin phonetic transcription of the SAME spoken words, not an English translation; optionally provide a faithful English translation. Preserve colloquial Tabrizi pronunciation, tone, intent and meaning. Return clean JSON with keys: persian_script, latin_phonetic, english_translation.`;
      const text = await openAIText(apiKey, system, prompt);
      return json({ dialogue: parseJson(text) || { persian_script: text, latin_phonetic: '', english_translation: '' } }, 200, origin);
    }

    if (body?.mode === 'diagnostic') {
      const system = `You are the Character Studio Smart Troubleshooter. Diagnose creative generation failures. Return JSON only with keys: diagnosis, confidence, next_question, question_options, likely_causes, immediate_fix, repaired_prompt, ask_more. Preserve intent and identity constraints.`;
      const text = await openAIText(apiKey, system, prompt); const parsed = parseJson(text);
      if (!parsed) return json({ error: 'Diagnostic engine returned invalid structured output.' }, 502, origin);
      return json({ diagnostic: parsed }, 200, origin);
    }

    const reference = typeof body?.reference === 'string' && body.reference.startsWith('data:image/') && body.reference.length <= MAX_REFERENCE_BYTES ? body.reference : null;

    if (body?.mode === 'director') {
      const settings = [
        `Direction/Tone: ${String(body?.tone || 'autonomous cinematic')}`,
        `Prompt Language: ${String(body?.promptLanguage || 'English')}`,
        `Dialogue Language: ${String(body?.dialogueLanguage || 'none')}`,
        `Visual Style: ${String(body?.style || 'Photorealistic Cinematic')}`,
        `Original Reference supplied: ${reference ? 'YES — inspect it and preserve identity' : 'NO'}`,
        `Elements: ${JSON.stringify(Array.isArray(body?.elements) ? body.elements : [])}`
      ].join('\n');
      const text = await openAIText(apiKey, DIRECTOR_SYSTEM, `${settings}\n\nMAIN CREATIVE REQUEST:\n${prompt}`, reference);
      const parsed = parseJson(text);
      if (!parsed) return json({ error: 'AI Director returned invalid structured output.', raw: text }, 502, origin);
      return json({ result: parsed }, 200, origin);
    }

    if (body?.mode === 'manual') {
      const engine = String(body?.engine || 'Project Engine');
      const settings = `ENGINE: ${engine}\nPrompt Language: ${String(body?.promptLanguage || 'English')}\nVisual Style: ${String(body?.style || 'Photorealistic Cinematic')}\nELEMENTS: ${JSON.stringify(Array.isArray(body?.elements) ? body.elements : [])}`;
      const text = await openAIText(apiKey, MANUAL_SYSTEM, `${settings}\n\nCREATIVE REQUEST:\n${prompt}`, reference);
      const parsed = parseJson(text);
      if (!parsed) return json({ result: { engine, result: text, prompts: [], next_steps: [] } }, 200, origin);
      return json({ result: parsed }, 200, origin);
    }

    const input = [{ role: 'user', content: reference ? [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: reference, detail: 'high' }] : [{ type: 'input_text', text: prompt }] }];
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
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
