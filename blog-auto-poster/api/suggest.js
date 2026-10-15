// GET /api/suggest?q=키워드&geo=KR|US|JP → 구글 자동완성 기반 연관 검색어(롱테일) 추천 (무료)
const LANG = { KR: { hl: 'ko', gl: 'kr' }, US: { hl: 'en', gl: 'us' }, JP: { hl: 'ja', gl: 'jp' } };
const SUFFIX = {
  KR: ['', ' ', ' 방법', ' 추천', ' 후기', ' 비교', ' 가격', ' 신청'],
  US: ['', ' ', ' how to', ' best', ' review', ' vs', ' price'],
  JP: ['', ' ', ' 方法', ' おすすめ', ' 口コミ', ' 比較', ' 料金'],
};

async function suggest(q, { hl, gl }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000);
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=${hl}&gl=${gl}&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BlogAutoPoster/1.0)' } });
    if (!r.ok) return [];
    const j = JSON.parse(await r.text());
    return Array.isArray(j?.[1]) ? j[1].filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  const geo = String(req.query.geo || 'KR').toUpperCase();
  const q = String(req.query.q || '').trim().slice(0, 50);
  if (!LANG[geo]) return res.status(400).json({ error: '지원하지 않는 국가입니다.' });
  if (q.length < 2) return res.status(400).json({ error: '키워드를 두 글자 이상 입력해 주세요.' });

  const lists = await Promise.all((SUFFIX[geo] || ['']).map((s) => suggest(q + s, LANG[geo])));
  const seen = new Set([q.toLowerCase()]);
  const out = [];
  for (const list of lists) {
    for (const s of list) {
      const k = s.replace(/\s+/g, ' ').trim();
      if (!k || seen.has(k.toLowerCase())) continue;
      seen.add(k.toLowerCase());
      out.push(k);
    }
  }
  // 입력 키워드를 포함하면서 더 구체적인(긴) 문구를 우선
  out.sort((a, b) => Number(b.includes(q)) - Number(a.includes(q)) || b.length - a.length);

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=600');
  return res.status(200).json({ q, geo, suggestions: out.slice(0, 16) });
};
