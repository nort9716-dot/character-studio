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

    if (body?.mode === 'dialogue') {
      const system = `You are the Character Studio Dialogue & Language Engine. Handle Tabrizi Azerbaijani carefully. The user may want Azerbaijani spoken in Tabriz written with Persian script, with Persian-script diacritics added only to clarify pronunciation; optionally provide a Latin phonetic transcription of the SAME spoken words, not an English translation; optionally provide a faithful English translation. Never replace a requested phonetic transcription with translation. Preserve colloquial Tabrizi pronunciation, tone, intent and meaning. Do not invent a different dialect. Return clean JSON with keys: persian_script, latin_phonetic, english_translation. If an output is not requested, return an empty string for that key.`;
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
      if (!response.ok) return json({ error: data?.error?.message || `OpenAI request failed (${response.status}).` }, response.status);
      const text = Array.isArray(data?.output)
        ? data.output.filter((x: any) => x?.type === 'message').flatMap((x: any) => x?.content || []).map((x: any) => x?.text || '').join('')
        : '';
      if (!text) return json({ error: 'No dialogue result returned.' }, 502);
      let parsed: any;
      try { parsed = JSON.parse(text.replace(/^```json\s*/,'').replace(/\s*```$/,'')); }
      catch { parsed = { persian_script: text, latin_phonetic: '', english_translation: '' }; }
      return json({ dialogue: parsed });
    }

    if (body?.mode === 'diagnostic') {
      const system = `You are the Character Studio Smart Troubleshooter. Diagnose failed or partially failed creative generations. Ask only the minimum useful questions needed to isolate the failure. Use the user's answers to distinguish prompt conflict, identity/reference conflict, anatomy/pose conflict, style/model incompatibility, unsupported wording, image/video continuity problems, dialogue/language problems, composition/camera conflicts, safety/policy rejection, API/credits/backend errors, or temporary generator failures. Do not blame the user. Be practical and precise. Return JSON only with keys: diagnosis, confidence, next_question, question_options, likely_causes, immediate_fix, repaired_prompt, ask_more. question_options must be an array of concise choices. If enough information exists, ask_more=false and provide a repaired_prompt; otherwise ask_more=true and provide exactly one next_question. Preserve the user's intent and identity constraints.`;
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
      if (!response.ok) return json({ error: data?.error?.message || `OpenAI request failed (${response.status}).` }, response.status);
      const text = Array.isArray(data?.output)
        ? data.output.filter((x: any) => x?.type === 'message').flatMap((x: any) => x?.content || []).map((x: any) => x?.text || '').join('')
        : '';
      if (!text) return json({ error: 'No diagnostic result returned.' }, 502);
      let parsed: any;
      try { parsed = JSON.parse(text.replace(/^```json\s*/,'').replace(/\s*```$/,'')); }
      catch { parsed = { diagnosis: text, confidence: 'medium', next_question: 'چه چیزی دقیقاً اتفاق افتاد؟', question_options: [], likely_causes: [], immediate_fix: '', repaired_prompt: '', ask_more: true }; }
      return json({ diagnostic: parsed });
    }

    const reference = typeof body?.reference === 'string' && body.reference.startsWith('data:image/') ? body.reference : null;
    const input = [{ role: 'user', content: reference ? [{ type: 'input_text', text: prompt }, { type: 'input_image', image_url: reference, detail: 'high' }] : [{ type: 'input_text', text: prompt }] }];
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.6-luna', input, tools: [{ type: 'image_generation', model: 'gpt-image-2', size: '1024x1536', quality: 'high', output_format: 'png' }] })
    });
    const data = await response.json();
    if (!response.ok) return json({ error: data?.error?.message || `OpenAI request failed (${response.status}).` }, response.status);
    const call = Array.isArray(data?.output) ? data.output.find((item: any) => item?.type === 'image_generation_call') : null;
    if (!call?.result) return json({ error: 'OpenAI completed the request but returned no image.' }, 502);
    return json({ image: `data:image/png;base64,${call.result}` });
  } catch (error: any) {
    console.error('Character Studio generation error:', error);
    return json({ error: error?.message || 'Generation failed.' }, 500);
  }
};

export const config = { path: '/api/generate' };
