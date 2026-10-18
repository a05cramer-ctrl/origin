const { scan } = require('./_lib');
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const data = await scan({ max: 10 });
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600');
    res.status(200).json(data);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String(e.message || e) });
  }
};
