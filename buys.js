// Hourly OG buys made by the ORIGIN wallet. Needs HELIUS_API_KEY (Vercel env) + ?wallet=.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const w = String((req.query && req.query.wallet) || '');
  const key = process.env.HELIUS_API_KEY;
  if (!key || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w)) return res.status(204).end();
  try {
    const r = await fetch(`https://api.helius.xyz/v0/addresses/${w}/transactions?api-key=${key}&type=SWAP&limit=50`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const txs = await r.json();
    const SOL = 'So11111111111111111111111111111111111111112';
    const buys = txs.map((t) => {
      const got = (t.tokenTransfers || []).find((x) => x.toUserAccount === w && x.mint !== SOL);
      const spent = (t.nativeTransfers || []).filter((x) => x.fromUserAccount === w).reduce((s, x) => s + x.amount, 0) / 1e9;
      return got ? { sig: t.signature, ts: t.timestamp * 1000, mint: got.mint, amount: got.tokenAmount, sol: +spent.toFixed(4) } : null;
    }).filter(Boolean);
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=300');
    res.status(200).json({ at: Date.now(), wallet: w, buys });
  } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
};
