// The website's API on Vercel: one serverless function running Vayro's own server code
// (server/index.mjs → handle), so lyrics, the library, artists and audio work in any browser.
//
// vercel.json rewrites /api/<anything> to /api/handler?__path=<anything>; the original URL is put
// back together here, so the server sees exactly the request the page made.
//
// Must be set before the server modules load (they read it at import time): the function's own
// folder is read-only, /tmp is writable (per instance — e.g. artists added from Discover).
process.env.AFTERGLOW_DATA ??= '/tmp/vayro';
const { handle } = await import('../server/index.mjs');

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const sub = url.searchParams.get('__path');
  if (sub !== null) {
    url.searchParams.delete('__path');
    const q = url.searchParams.toString();
    req.url = `/api/${sub}${q ? `?${q}` : ''}`;
  }
  return handle(req, res);
}
