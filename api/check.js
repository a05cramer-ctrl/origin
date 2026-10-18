const { check } = require('./_lib');
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ca = String((req.query && req.query.ca) || '').trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(ca)) return res.status(400).json({ error: 'not a Solana address' });
  try {
    const data = await check(ca);
    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
    res.status(200).json(data);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String(e.message || e) });
  }
};
