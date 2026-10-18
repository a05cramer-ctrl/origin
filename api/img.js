// Image proxy so the page can read PFP pixels (halftone render + PFP match). Small, cached, CORS-open.
const ALLOW = /^https:\/\//i;
function rewrite(u) {
  const m = u.match(/\/ipfs\/([A-Za-z0-9]+)(\/.*)?$/) || u.match(/^https:\/\/([a-z0-9]{46,})\.ipfs\.[^/]+(\/.*)?$/i);
  return m ? ['https://gateway.pinata.cloud/ipfs/' + m[1] + (m[2] || ''), u] : [u];
}
module.exports = async (req, res) => {
  const u = String((req.query && req.query.u) || '');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!ALLOW.test(u)) return res.status(400).end();
  const tries = [...rewrite(u), 'https://wsrv.nl/?w=256&h=256&fit=cover&output=png&url=' + encodeURIComponent(u)];
  for (const t of tries) {
    try {
      const r = await fetch(t, { headers: { 'user-agent': 'origin-img/1.0' }, redirect: 'follow' });
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || !/^image\//.test(ct) || /svg/.test(ct)) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 4e6) continue;
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, s-maxage=604800, max-age=86400, immutable');
      return res.status(200).send(buf);
    } catch {}
  }
  res.setHeader('Cache-Control', 's-maxage=300');
  res.status(404).end();
};
