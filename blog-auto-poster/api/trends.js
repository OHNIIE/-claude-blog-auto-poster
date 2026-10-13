// GET /api/trends?geo=KR|US|JP  → 구글 트렌드 실시간 급상승 검색어 Top 10 (무료 RSS)
const GEOS = ['KR', 'US', 'JP'];

function decode(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
}

module.exports = async (req, res) => {
  const geo = String(req.query.geo || 'KR').toUpperCase();
  if (!GEOS.includes(geo)) return res.status(400).json({ error: '지원하지 않는 국가입니다.' });

  try {
    const r = await fetch(`https://trends.google.com/trending/rss?geo=${geo}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BlogAutoPoster/1.0)' },
    });
    if (!r.ok) throw new Error(`Google Trends 응답 오류 (${r.status})`);
    const xml = await r.text();

    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    const keywords = items
      .map((it) => {
        const m = it.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
        return m ? decode(m[1].trim()) : null;
      })
      .filter(Boolean)
      .slice(0, 10);

    if (!keywords.length) throw new Error('키워드를 찾지 못했습니다.');

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=600');
    return res.status(200).json({ geo, keywords, updatedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(502).json({ error: e.message || '트렌드 수집 실패' });
  }
};
