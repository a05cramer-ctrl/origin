// ORIGIN data layer. Shared by api/scan.js and api/check.js.
// Sources: Jupiter token API (runners + same-ticker search) and pump.fun search (exact create times).
const JUP = 'https://lite-api.jup.ag/tokens/v2';
const PUMP = 'https://frontend-api-v3.pump.fun';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'origin-scan/1.0' } });
      if (r.status === 429) { await sleep(700 * (i + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { last = e; await sleep(300 * (i + 1)); }
  }
  throw last || new Error('rate limited');
}

const norm = (s) => String(s || '').toUpperCase().replace(/^\$/, '').replace(/\s+/g, '').trim();
const words = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
// Same coin = same ticker AND same name (exact, near-exact, or >=60% shared words). Same ticker alone is just a squatter.
function sameName(a, b) {
  const A = words(a), B = words(b);
  if (!A.length || !B.length) return false;
  const ja = A.join(''), jb = B.join('');
  if (ja === jb) return true;
  const s = ja.length < jb.length ? ja : jb, l = ja.length < jb.length ? jb : ja;
  if (s.length >= 4 && l.includes(s) && s.length / l.length >= 0.6) return true;
  const sa = new Set(A), sb = new Set(B); let i = 0;
  for (const w of sa) if (sb.has(w)) i++;
  return i / new Set([...A, ...B]).size >= 0.6;
}

function fromJup(t) {
  const created = Date.parse(t.firstPool?.createdAt || t.createdAt || '') || null;
  const s1 = t.stats1h || {};
  return {
    mint: t.id, name: t.name || '', symbol: t.symbol || '', icon: t.icon || null,
    created, mcap: Math.round(t.mcap || t.fdv || 0), liq: Math.round(t.liquidity || 0),
    vol1h: Math.round((s1.buyVolume || 0) + (s1.sellVolume || 0)),
    ch1h: typeof s1.priceChange === 'number' ? s1.priceChange : null,
    pad: t.launchpad || null, dev: t.dev || null, holders: t.holderCount || 0,
  };
}

function fromPump(c) {
  return {
    mint: c.mint, name: c.name || '', symbol: c.symbol || '', icon: c.image_uri || null,
    created: c.created_timestamp || null, mcap: Math.round(c.usd_market_cap || 0), liq: 0,
    vol1h: 0, ch1h: null, pad: 'pump.fun', dev: c.creator || null, holders: 0,
  };
}

async function pumpSearch(symbol) {
  // pump.fun has exact create times for every pump coin, including dead ones Jupiter drops.
  const out = [];
  for (let off = 0; off < 100; off += 50) {
    try {
      const q = `${PUMP}/coins/search-v2?searchTerm=${encodeURIComponent(symbol)}&limit=50&offset=${off}&includeNsfw=false`;
      const res = await getJSON(q, 2);
      const arr = Array.isArray(res) ? res : (res.coins || res.data || []);
      out.push(...arr);
      if (arr.length < 50) break;
    } catch { break; }
  }
  return out;
}

// Every coin on Solana that carries this ticker, oldest first.
async function family(symbol, { withPump = true } = {}) {
  const key = norm(symbol);
  if (!key) return [];
  const byMint = new Map();
  const jup = await getJSON(`${JUP}/search?query=${encodeURIComponent(symbol)}&limit=100`).catch(() => []);
  for (const t of jup || []) if (norm(t.symbol) === key) byMint.set(t.id, fromJup(t));
  if (withPump) {
    for (const c of await pumpSearch(symbol)) {
      if (norm(c.symbol) !== key || !c.mint) continue;
      const cur = byMint.get(c.mint);
      if (cur) { if (c.created_timestamp) cur.created = Math.min(cur.created || Infinity, c.created_timestamp); }
      else byMint.set(c.mint, fromPump(c));
    }
  }
  return [...byMint.values()].filter((x) => x.created).sort((a, b) => a.created - b.created);
}

function shape(all, focus) {
  const fam = all.filter((x) => sameName(x.name, focus.name));
  const og = fam[0];
  const idx = fam.findIndex((x) => x.mint === focus?.mint);
  return {
    og, total: fam.length,
    focusRank: idx, // 0 = the OG itself, n = copy #n
    copies: fam.slice(1, 61).map((c, i) => ({ ...c, n: i + 1 })),
    tickerOnly: all.length - fam.length, // other coins squatting the same ticker
  };
}

async function scan({ max = 10, withPump = true } = {}) {
  const board = await getJSON(`${JUP}/toptraded/1h?limit=100`);
  const seen = new Set();
  const runners = board.map(fromJup)
    .filter((t) => t.pad === 'pump.fun' && t.mcap >= 30000)
    .sort((a, b) => b.vol1h - a.vol1h)
    .filter((t) => { const k = norm(t.symbol); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, max);
  const one = async (r) => {
    try {
      const fam = await family(r.symbol, { withPump });
      if (!fam.find((x) => x.mint === r.mint)) { fam.push(r); fam.sort((a, b) => a.created - b.created); }
      const live = fam.find((x) => x.mint === r.mint);
      Object.assign(live, r, { created: Math.min(live.created || Infinity, r.created || Infinity) });
      return { runner: r, ...shape(fam, r) };
    } catch (e) { return { runner: r, error: String(e.message || e) }; }
  };
  const out = [];
  for (let i = 0; i < runners.length; i += 3) { // small batches keep Jupiter's rate limit happy
    out.push(...(await Promise.all(runners.slice(i, i + 3).map(one))));
    if (i + 3 < runners.length) await sleep(450);
  }
  return { at: Date.now(), runners: out };
}

async function check(ca, { withPump = true } = {}) {
  const hits = await getJSON(`${JUP}/search?query=${encodeURIComponent(ca)}&limit=5`);
  const t = (hits || []).find((x) => x.id === ca);
  if (!t) return { at: Date.now(), found: false };
  const me = fromJup(t);
  const fam = await family(me.symbol, { withPump });
  if (!fam.find((x) => x.mint === me.mint)) { fam.push(me); fam.sort((a, b) => a.created - b.created); }
  return { at: Date.now(), found: true, coin: me, ...shape(fam, me) };
}

module.exports = { scan, check, family, getJSON, norm, sameName };
