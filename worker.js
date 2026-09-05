const MAX_PROMPT = 30000;
const MAX_REFERENCE_BYTES = 12_000_000;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 20;
const rateMap = new Map();

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store, no-cache, must-revalidate',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      ...extraHeaders
    }
  });
}

function clientKey(request) {
  return (request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
}

function rateLimited(key) {
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

function getOpenAIKey(env) {
  // Primary binding plus safe compatibility aliases for the temporary casing mistakes
  // that existed while the Cloudflare secret was being created.
  const names = ['OPENAI_API_KEY', 'OPENAI_API_key', 'OPENAI_API_Key', 'OPENAI_API_KEY1'];
  for (const name of names) {
    const value = typeof env?.[name] === 'string' ? env[name].trim() : '';
    if (value) return { value, source: `env.${name}` };
  }

  // Cloudflare supports process.env when Node.js compatibility is enabled.
  try {
    const processEnv = globalThis?.process?.env;
    for (const name of names) {
      const value = typeof processEnv?.[name] === 'string' ? processEnv[name].trim() : '';
      if (value) return { value, source: `process.env.${name}` };
    }
  } catch {}

  return { value: '', source: null };
}

function extractText(data) {
  return Array.isArray(data?.output)
    ? data.output.filter(x => x?.type === 'message').flatMap(x => x?.content || []).map(x => x?.text || '').join('')
    : '';
}

function parseJson(text) {
  try { return JSON.parse(String(text).replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()); }
  catch { return null; }
}

async function openAIText(apiKey, system, prompt, reference = null) {
  const content = [{ type: 'input_text', text: prompt }];
  if (reference) content.push({ type: 'input_image', image_url: reference, detail: 'high' });
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-5.6-luna',
      input: [
        { role: 'system', content: [{ type: 'input_text', text: system }] },
        { role: 'user', content }
      ]
    })
  });
  const raw = await response.text();
  let data = {};
  try { data = JSON.parse(raw); } catch {}
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI request failed (${response.status}).`);
  const text = extractText(data);
  if (!text) throw new Error('No text result returned.');
  return text;
}

const DIRECTOR_SYSTEM = `You are the Autonomous AI Director inside Character Studio. Turn one creative request into a production-ready package. Make creative decisions autonomously unless essential information is genuinely missing. Preserve immutable identity/reference rules. Character, Location, Outfit and Prop are independent roles and must never be merged or swapped. If an Original Reference image is supplied, treat it as the identity authority. Do not slim, reshape, age, de-age, replace or redesign the character. Do not invent dialogue. Extract only dialogue actually present in the user's main request. Return JSON only with exactly these keys: project, story, storyboard, shots, dialogue, element_mapping, continuity, seedance_prompt. project/story/storyboard/continuity are strings. shots is an array of objects with keys shot, scene, action, camera, lighting, duration, prompt. dialogue is an array of objects with keys speaker, line, language. element_mapping is an array of objects with keys element, role, rule. seedance_prompt is one complete copy-ready Seedance 2.5 video prompt. The seedance prompt must explicitly preserve Element roles, reference identity, spatial continuity, motion, camera, lighting, dialogue synchronization and negative constraints. If there is no dialogue, return an empty dialogue array. Never return markdown fences.`;

const MANUAL_SYSTEM = `You are a professional creative-production engine inside Character Studio. Execute the selected manual engine as a real production step, not generic advice. Preserve immutable identity/reference constraints: an Original Reference is the sole identity authority; generated outputs are never identity references; never alter face, age, hair identity, skin, body volume, proportions or silhouette. Keep Character, Location, Outfit and Prop roles independent and never merge or swap them. Use the supplied engine-specific detail as binding production context when present. For Image / Video Prompts, return at least one complete, usable Seedance 2.5 video prompt with explicit duration, aspect ratio if supplied, subject/action, spatial continuity, camera and motion path, lighting, timing, dialogue synchronization only for dialogue actually supplied, sound, identity protection and negative constraints. For Dialogue / Music / Sound, do not invent spoken dialogue. For Continuity / Generation / Export, include a concrete generation order and validation checklist. Return JSON only with exactly these keys: engine, result, prompts, next_steps. result is substantive and structured plain text; prompts is an array of complete copy-ready prompts when applicable; next_steps is an array of concrete actions. Never return markdown fences.`;

async function handleApi(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (origin && new URL(request.url).origin !== origin) return json({ error: 'Forbidden origin.' }, 403);
  if (request.method === 'OPTIONS') return json({ ok: true });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (rateLimited(clientKey(request))) return json({ error: 'Too many requests. Please wait a minute and try again.' }, 429);

  const { value: apiKey } = getOpenAIKey(env);
  if (!apiKey) return json({ error: 'OPENAI_API_KEY is not configured on Cloudflare Worker.' }, 503);

  const body = await request.json();
  const prompt = String(body?.prompt || '').trim();
  if (!prompt) return json({ error: 'Prompt is required.' }, 400);
  if (prompt.length > MAX_PROMPT) return json({ error: 'Prompt is too large.' }, 413);

  if (body?.mode === 'dialogue') {
    const system = `You are the Character Studio Dialogue & Language Engine. Handle Tabrizi Azerbaijani carefully. The user may want Azerbaijani spoken in Tabriz written with Persian script, with Persian-script diacritics only when useful; optionally provide a Latin phonetic transcription of the SAME spoken words, not an English translation; optionally provide a faithful English translation. Preserve colloquial Tabrizi pronunciation, tone, intent and meaning. Return clean JSON with keys: persian_script, latin_phonetic, english_translation.`;
    const text = await openAIText(apiKey, system, prompt);
    return json({ dialogue: parseJson(text) || { persian_script: text, latin_phonetic: '', english_translation: '' } });
  }

  if (body?.mode === 'diagnostic') {
    const system = `You are the Character Studio Smart Troubleshooter. Diagnose creative generation failures. Return JSON only with keys: diagnosis, confidence, next_question, question_options, likely_causes, immediate_fix, repaired_prompt, ask_more. Preserve intent and identity constraints.`;
    const text = await openAIText(apiKey, system, prompt);
    const parsed = parseJson(text);
    if (!parsed) return json({ error: 'Diagnostic engine returned invalid structured output.' }, 502);
    return json({ diagnostic: parsed });
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
    if (!parsed) return json({ error: 'AI Director returned invalid structured output.', raw: text }, 502);
    return json({ result: parsed });
  }

  if (body?.mode === 'manual') {
    const engine = String(body?.engine || 'Project Engine');
    const settings = `ENGINE: ${engine}\nPrompt Language: ${String(body?.promptLanguage || 'English')}\nDialogue Language: ${String(body?.dialogueLanguage || 'none')}\nVisual Style: ${String(body?.style || 'Photorealistic Cinematic')}\nDirection/Tone: ${String(body?.tone || 'production-ready')}\nENGINE-SPECIFIC PRODUCTION DETAIL: ${String(body?.manualDetail || 'None supplied')}\nELEMENTS: ${JSON.stringify(Array.isArray(body?.elements) ? body.elements : [])}`;
    const text = await openAIText(apiKey, MANUAL_SYSTEM, `${settings}\n\nCREATIVE REQUEST:\n${prompt}`, reference);
    const parsed = parseJson(text);
    if (!parsed) return json({ result: { engine, result: text, prompts: [], next_steps: [] } });
    return json({ result: parsed });
  }

  const input = [{ role: 'user', content: reference
    ? [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: reference, detail: 'high' }]
    : [{ type: 'input_text', text: prompt }] }];
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-5.6-luna',
      input,
      tools: [{ type: 'image_generation', model: 'gpt-image-2', size: '1024x1536', quality: 'high', output_format: 'png' }]
    })
  });
  const raw = await response.text();
  let data = {};
  try { data = JSON.parse(raw); } catch {}
  if (!response.ok) return json({ error: data?.error?.message || `OpenAI request failed (${response.status}).` }, response.status);
  const call = Array.isArray(data?.output) ? data.output.find(item => item?.type === 'image_generation_call') : null;
  if (!call?.result) return json({ error: 'OpenAI completed the request but returned no image.' }, 502);
  return json({ image: `data:image/png;base64,${call.result}` });
}

async function serveAsset(request, env) {
  const response = await env.ASSETS.fetch(request);
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;

  const html = await response.text();
  const migrated = html
    .replaceAll('https://character-studio-nort9716.netlify.app/api/generate', '/api/generate')
    .replaceAll('https://main--character-studio-nort9716.netlify.app/api/generate', '/api/generate');
  const bootstrap = `<script>(function(){try{var d=JSON.parse(localStorage.getItem('CS_DB')||'null');if(d&&d.settings&&typeof d.settings.apiUrl==='string'&&d.settings.apiUrl.includes('character-studio-nort9716.netlify.app')){d.settings.apiUrl='/api/generate';localStorage.setItem('CS_DB',JSON.stringify(d));}var a=localStorage.getItem('cs_api');if(a&&a.includes('character-studio-nort9716.netlify.app'))localStorage.setItem('cs_api','/api/generate');}catch(e){}})();</script>`;
  const body = migrated.includes('</body>') ? migrated.replace('</body>', `${bootstrap}</body>`) : `${migrated}${bootstrap}`;
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.delete('content-length');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/status') {
        const { value, source } = getOpenAIKey(env);
        return json({
          ok: true,
          worker: 'character-studio',
          openaiKeyConfigured: Boolean(value),
          keySource: source,
          assetsBindingConfigured: Boolean(env?.ASSETS),
          timestamp: new Date().toISOString()
        });
      }
      if (url.pathname === '/api/generate') return await handleApi(request, env);
      return await serveAsset(request, env);
    } catch (error) {
      return json({ error: error?.message || 'Generation failed.' }, 500);
    }
  }
};
