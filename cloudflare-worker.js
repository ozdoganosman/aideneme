// Tiny CORS proxy for Yahoo Finance (or any URL), to use as the app's "CORS
// proxy URL". Free and reliable, unlike public proxies.
//
// Deploy (≈2 min, free, no card):
//   1. https://dash.cloudflare.com → Workers & Pages → Create → Worker
//   2. Paste this file, Deploy. You'll get a URL like
//      https://borsa-proxy.<you>.workers.dev
//   3. In the app (BIST/Yahoo source), set the proxy URL to:
//      https://borsa-proxy.<you>.workers.dev/?url=
//
// Optionally lock it to your own site by setting ALLOW_ORIGIN below.

const ALLOW_ORIGIN = '*'; // e.g. 'https://ozdoganosman.github.io'

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors() });
    }
    const target = new URL(request.url).searchParams.get('url');
    if (!target) return new Response('missing ?url=', { status: 400, headers: cors() });

    let upstream;
    try {
      upstream = await fetch(target, {
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json,text/plain,*/*' },
      });
    } catch (e) {
      return new Response('upstream error: ' + e, { status: 502, headers: cors() });
    }

    const headers = cors();
    headers.set('content-type', upstream.headers.get('content-type') || 'application/json');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};

function cors() {
  const h = new Headers();
  h.set('access-control-allow-origin', ALLOW_ORIGIN);
  h.set('access-control-allow-methods', 'GET,OPTIONS');
  h.set('access-control-allow-headers', '*');
  return h;
}
