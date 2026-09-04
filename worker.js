import { onRequest as generate } from './functions/api/generate.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/generate') {
      return generate({ request, env, waitUntil: ctx.waitUntil.bind(ctx), next: () => new Response('Not found', { status: 404 }) });
    }
    return env.ASSETS.fetch(request);
  }
};
