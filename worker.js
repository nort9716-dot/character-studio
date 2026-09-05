import { onRequest as generate } from './functions/api/generate.js';

function sameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try { return new URL(origin).origin === url.origin; } catch { return false; }
}

async function serveAsset(request, env) {
  const response = await env.ASSETS.fetch(request);
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;

  const html = await response.text();
  const migrated = html
    .replaceAll('https://character-studio-nort9716.netlify.app/api/generate', '/api/generate')
    .replaceAll('https://main--character-studio-nort9716.netlify.app/api/generate', '/api/generate');

  const bootstrap = `<script>(function(){try{var d=JSON.parse(localStorage.getItem('CS_DB')||'null');if(d&&d.settings&&typeof d.settings.apiUrl==='string'&&d.settings.apiUrl.includes('character-studio-nort9716.netlify.app')){d.settings.apiUrl='/api/generate';localStorage.setItem('CS_DB',JSON.stringify(d));}}catch(e){}})();</script>`;
  const body = migrated.includes('</body>') ? migrated.replace('</body>', `${bootstrap}</body>`) : `${migrated}${bootstrap}`;

  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/generate') {
      if (!sameOrigin(request, url)) return new Response(JSON.stringify({ error: 'Forbidden origin.' }), { status: 403, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
      return generate({ request, env, waitUntil: ctx.waitUntil.bind(ctx), next: () => new Response('Not found', { status: 404 }) });
    }

    return serveAsset(request, env);
  }
};
