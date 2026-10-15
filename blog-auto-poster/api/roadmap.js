// POST /api/roadmap { topic, count, perWeek, existing, grounding }
// 메인 주제 → 허브/롱테일 글 로드맵 (작성 순서·발행 일정·내부 링크·시즌 글 배치)
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const INTENTS = ['정보', '방법', '비교', '신청', '후기', '체크리스트'];
const STR = { type: 'STRING' };
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: STR,
    clusters: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: STR, desc: STR }, required: ['name', 'desc'] } },
    posts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          order: { type: 'INTEGER' }, cluster: STR, title: STR, keyword: STR, intent: STR,
          isPillar: { type: 'BOOLEAN' }, seasonal: { type: 'BOOLEAN' },
          peakDate: { type: 'STRING', nullable: true }, peakNote: { type: 'STRING', nullable: true },
          linkTo: { type: 'ARRAY', items: { type: 'INTEGER' } }, reason: STR,
        },
        required: ['order', 'cluster', 'title', 'keyword', 'intent', 'isPillar', 'seasonal', 'linkTo', 'reason'],
      },
    },
  },
  required: ['summary', 'clusters', 'posts'],
};

/* ---------- 날짜 도우미 (서울 기준) ---------- */
const DAY = 86400000;
const parseYmd = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(new Date(s + 'T12:00:00Z')) ? new Date(s + 'T12:00:00Z') : null);
const ymdOf = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const seoulToday = () => parseYmd(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }));

/* ---------- 일정 배치: 시즌 글은 '피크 3주 전'까지 발행되도록 앞당김 ---------- */
function schedule(posts, perWeek) {
  // 평일 위주 발행일: 주2회=화·금, 주3회=월·수·금, 주5회=월~금
  const dows = { 2: [2, 5], 3: [1, 3, 5], 5: [1, 2, 3, 4, 5] }[perWeek] || [1, 3, 5];
  const today = seoulToday();
  const start = addDays(today, 1);
  const slots = [];
  for (let n = 0; slots.length < 80; n++) {
    const d = addDays(start, n);
    if (dows.includes(d.getUTCDay())) slots.push(d);
  }
  const slot = (i) => slots[i];

  const regular = [];
  const timed = [];
  for (const p of posts) {
    const peak = p.seasonal ? parseYmd(p.peakDate) : null;
    if (peak && peak > today) {
      p.publishBy = ymdOf(addDays(peak, -21));
      timed.push(p);
    } else {
      p.seasonal = false; p.peakDate = null; p.peakNote = null; p.publishBy = null;
      regular.push(p);
    }
  }
  timed.sort((a, b) => a.publishBy.localeCompare(b.publishBy));

  const out = [];
  let i = 0;
  while (regular.length || timed.length) {
    const d = slot(i);
    const urgent = timed.length && parseYmd(timed[0].publishBy) <= addDays(d, 14);
    const pick = urgent || !regular.length ? timed.shift() : regular.shift();
    pick.date = ymdOf(d);
    pick.late = !!pick.publishBy && pick.date > pick.publishBy;
    out.push(pick);
    i++;
  }
  return out;
}

function finalize(d, count, perWeek) {
  let posts = (Array.isArray(d.posts) ? d.posts : []).filter((p) => p && p.title && p.keyword);
  posts.sort((a, b) => (a.order || 0) - (b.order || 0));

  const seen = new Set();
  posts = posts.filter((p) => {
    const k = String(p.keyword).replace(/\s+/g, '').toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, count);

  const byOrder = new Map();
  posts.forEach((p, i) => { p.id = i + 1; if (!byOrder.has(p.order)) byOrder.set(p.order, p); });
  posts.forEach((p) => {
    const ids = (Array.isArray(p.linkTo) ? p.linkTo : []).map((o) => byOrder.get(o)?.id).filter((id) => id && id !== p.id);
    p.linkIds = [...new Set(ids)].slice(0, 3);
    p.intent = INTENTS.includes(p.intent) ? p.intent : '정보';
  });

  const ordered = schedule(posts, perWeek);
  const noById = new Map(ordered.map((p, i) => [p.id, i + 1]));
  const outPosts = ordered.map((p, i) => ({
    no: i + 1,
    date: p.date,
    title: String(p.title).slice(0, 120),
    keyword: String(p.keyword).slice(0, 80),
    intent: p.intent,
    cluster: String(p.cluster || '').slice(0, 40),
    isPillar: !!p.isPillar,
    seasonal: !!p.seasonal,
    peakNote: p.peakNote ? String(p.peakNote).slice(0, 80) : null,
    peakDate: p.peakDate || null,
    publishBy: p.publishBy || null,
    late: !!p.late,
    linkTo: p.linkIds.map((id) => noById.get(id)).filter(Boolean),
    reason: String(p.reason || '').slice(0, 80),
  }));
  return {
    summary: String(d.summary || '').slice(0, 400),
    clusters: (Array.isArray(d.clusters) ? d.clusters : []).slice(0, 6).map((c) => ({ name: String(c.name || '').slice(0, 30), desc: String(c.desc || '').slice(0, 100) })),
    posts: outPosts,
  };
}

/* ---------- 프롬프트 ---------- */
function buildPrompt({ topic, count, today, existing, notes }) {
  const maxSeason = Math.max(3, Math.round(count * 0.3));
  return `당신은 구글 SEO와 애드센스 수익형 블로그 전략가입니다. 한국어 티스토리 블로그의 '주제 로드맵'을 설계하세요.

[블로그 메인 주제] ${topic}
[오늘 날짜] ${today}
[글 개수] 정확히 ${count}개
[이미 쓴 글 - 겹치지 않게] ${existing || '없음'}
${notes ? `\n[최신 조사 노트 - 오늘 웹 검색으로 확인한 시즌·일정 정보]\n${notes}\n` : ''}
[설계 원칙]
- 메인 주제 안에서 클러스터(세부 주제 묶음)를 3~5개 만들 것. 메인 주제를 벗어난 글은 금지.
- 각 클러스터의 첫 글은 허브 글(isPillar=true): 그 분야 전체를 안내하는 포괄 가이드. 나머지는 허브로 연결되는 구체적인 롱테일 글.
- keyword: 실제 사람이 검색할 2~5단어 한국어 롱테일 (예: "에너지바우처 신청 방법"). 사람 이름·스포츠·연예 같은 뉴스성 키워드와 한 단어짜리 넓은 키워드는 금지.
- intent: 정보 / 방법 / 비교 / 신청 / 후기 / 체크리스트 중 하나.
- title: 키워드를 앞쪽에 넣은 클릭 유도 제목. 과장·낚시 금지, 35자 안팎.
- 제외: 대출·보험·카드·투자 상품 추천, 의료·건강 진단/치료 조언 (정확성 책임이 큰 분야). 지원금·제도 글은 '공식 사이트에서 확인' 전제의 안내 글로 기획.
- 시즌 글은 최대 ${maxSeason}개. 오늘 이후 3~4개월 안에 검색이 몰릴 주제만 고를 것. seasonal=true이면 peakDate(검색이 가장 몰릴 시점, YYYY-MM-DD 추정)와 peakNote(예: "연말정산 검색 1~2월 피크")를 반드시 채우고, 시즌 글이 아니면 seasonal=false, peakDate와 peakNote는 null. 조사 노트가 있으면 그 일정만 근거로 삼고, 없으면 해마다 반복되는 일반 패턴만 쓰되 구체적인 날짜·금액은 단정하지 말 것.
- order: 권장 작성 순서 1~${count} (중복 없이). 허브 글은 같은 클러스터의 다른 글보다 앞에.
- linkTo: 이 글 본문에서 링크로 연결할 다른 글의 order 1~3개 (같은 클러스터 허브 글 포함, 자기 자신 제외).
- reason: 이 글을 쓰는 이유 한 줄 (40자 이내).
- summary: 이 로드맵의 전략을 2문장으로.

[출력] 아래 형태의 JSON 하나만 출력. 마크다운·설명 금지.
{"summary":"","clusters":[{"name":"","desc":""}],"posts":[{"order":1,"cluster":"","title":"","keyword":"","intent":"정보","isPillar":true,"seasonal":false,"peakDate":null,"peakNote":null,"linkTo":[2],"reason":""}]}`;
}

function parseJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const s = cleaned.indexOf('{');
    const e = cleaned.lastIndexOf('}');
    if (s >= 0 && e > s) return JSON.parse(cleaned.slice(s, e + 1));
    throw new Error('parse');
  }
}

const httpErr = (status, msg, extra = {}) => Object.assign(new Error(msg), { status }, extra);

async function callJson(apiKey, prompt, useSchema = true) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: 'application/json',
        maxOutputTokens: 16384,
        ...(useSchema ? { responseSchema: SCHEMA } : {}),
      },
    }),
  });
  if (r.status === 429) throw httpErr(429, '무료 사용량 한도에 도달했어요. 잠시 후 다시 시도해 주세요.');
  if (r.status === 400 && useSchema) return callJson(apiKey, prompt, false);
  if (!r.ok) throw httpErr(502, `Gemini 오류 (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) throw httpErr(502, 'AI가 빈 응답을 보냈어요. 다시 시도해 주세요.');
  try {
    return parseJson(text);
  } catch {
    throw httpErr(502, 'AI 응답 형식이 잠깐 깨졌어요. 다시 한 번 눌러 주세요.', { parse: true });
  }
}

/* ---------- 구글 검색으로 시즌 일정 조사 (실패해도 계속 진행) ---------- */
async function research(apiKey, topic, today) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 28000);
  try {
    const prompt = `오늘은 ${today}입니다. 웹 검색으로 한국에서 오늘부터 약 4개월 동안, "${topic}" 분야와 관련해 검색이 몰릴 시즌 이슈·신청 일정·제도 변경을 조사해 한국어 노트로 정리하세요.
규칙:
- 검색으로 확인된 것만 쓰고 추측하지 말 것.
- 항목마다 이름, 대략의 시점(날짜 또는 월), 근거 기관/매체를 적을 것.
- 15개 이내, 항목당 1문장.
- 확인된 정보가 없으면 '확인된 정보 없음'이라고만 답할 것.`;
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const cand = j?.candidates?.[0];
    const notes = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
    if (notes.length < 40 || /^확인된 정보 없음/.test(notes)) return null;
    const seen = new Set();
    const sources = [];
    for (const c of cand?.groundingMetadata?.groundingChunks || []) {
      const w = c?.web;
      if (!w?.uri || !/^https:\/\//.test(w.uri)) continue;
      const key = w.title || w.uri;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({ title: String(w.title || w.uri).slice(0, 80), uri: w.uri });
      if (sources.length >= 8) break;
    }
    return { notes: notes.slice(0, 6000), sources };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 지원합니다.' });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: '서버에 GEMINI_API_KEY가 설정되지 않았습니다.' });
  const need = process.env.ACCESS_CODE;
  if (need && req.headers['x-access-code'] !== need) return res.status(401).json({ error: '접근코드가 올바르지 않습니다.' });

  const b = req.body || {};
  const topic = String(b.topic || '').trim().slice(0, 80);
  if (topic.length < 2) return res.status(400).json({ error: '메인 주제를 입력해 주세요.' });
  const count = [20, 30].includes(Number(b.count)) ? Number(b.count) : 20;
  const perWeek = [2, 3, 5].includes(Number(b.perWeek)) ? Number(b.perWeek) : 3;
  const existing = String(b.existing || '').trim().slice(0, 1500);
  const useGrounding = b.grounding !== false && process.env.GROUNDING !== 'off';
  const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' });

  try {
    const facts = useGrounding ? await research(apiKey, topic, today) : null;
    const prompt = buildPrompt({ topic, count, today, existing, notes: facts?.notes });
    let raw;
    try {
      raw = await callJson(apiKey, prompt);
    } catch (e) {
      if (!e.parse) throw e;
      raw = await callJson(apiKey, prompt); // 형식 오류는 자동으로 한 번 더
    }
    const roadmap = finalize(raw, count, perWeek);
    if (roadmap.posts.length < 5) return res.status(502).json({ error: '로드맵이 너무 짧게 나왔어요. 다시 한 번 눌러 주세요.' });
    return res.status(200).json({ roadmap, grounded: !!facts, sources: facts?.sources || [] });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || '로드맵 생성 중 오류가 발생했어요.' });
  }
};
module.exports._schedule = schedule;
