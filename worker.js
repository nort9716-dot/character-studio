const LEGACY_API = 'https://character-studio-nort9716.netlify.app/api/generate';

function sameOrigin(request, url) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try { return new URL(origin).origin === url.origin; } catch { return false; }
}

async function proxyApi(request, url) {
  if (!sameOrigin(request, url)) {
    return new Response(JSON.stringify({ error: 'Forbidden origin.' }), {
      status: 403,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
    });
  }

  const headers = new Headers();
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  const upstream = await fetch(LEGACY_API, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer()
  });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.set('cache-control', 'no-store');
  responseHeaders.set('x-content-type-options', 'nosniff');
  responseHeaders.set('referrer-policy', 'no-referrer');
  responseHeaders.set('x-character-studio-backend', 'netlify-bridge');
  responseHeaders.delete('content-length');
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
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
  headers.set('cache-control', 'no-store');
  headers.delete('content-length');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/generate') return proxyApi(request, url);
    return serveAsset(request, env);
  }
};
