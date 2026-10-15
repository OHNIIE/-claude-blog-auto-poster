// POST /api/generate  { keyword, concept, geo }  → 포스팅 구조화 JSON
// API 키는 Vercel 환경변수(GEMINI_API_KEY)에만 보관됩니다.

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MIN_CHARS = 1500; // 본문 최소 글자 수(공백 제외)
const STR = { type: 'STRING' };
const ARR = (items, extra = {}) => ({ type: 'ARRAY', items, ...extra });
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    titles: ARR(STR),
    meta: STR,
    tags: ARR(STR),
    summary: STR,
    thumbnailScene: STR,
    thumbnailAlt: STR,
    sections: ARR({
      type: 'OBJECT',
      properties: {
        role: STR, icon: STR, heading: STR, oneLine: STR,
        body: ARR(STR),
        keyPoints: ARR({ type: 'OBJECT', properties: { title: STR, desc: STR }, required: ['title', 'desc'] }),
        tip: STR, imageScene: STR, imageAlt: STR,
        links: ARR({
          type: 'OBJECT',
          properties: { anchor: STR, label: STR, query: STR, officialUrl: { type: 'STRING', nullable: true } },
          required: ['label', 'query'],
        }),
      },
      required: ['heading', 'oneLine', 'body', 'keyPoints', 'tip', 'imageScene', 'imageAlt'],
    }),
    comparisonTable: {
      type: 'OBJECT', nullable: true,
      properties: {
        headers: ARR(STR),
        rows: ARR({ type: 'OBJECT', properties: { cells: ARR(STR) }, required: ['cells'] }),
      },
      required: ['headers', 'rows'],
    },
    checklist: ARR(STR, { nullable: true }),
    qna: ARR({ type: 'OBJECT', properties: { q: STR, a: STR }, required: ['q', 'a'] }),
    closing: STR,
  },
  required: ['titles', 'meta', 'tags', 'summary', 'thumbnailScene', 'thumbnailAlt', 'sections', 'qna', 'closing'],
};

function toRoot(u) {
  try {
    const x = new URL(String(u).trim());
    if (x.protocol !== 'https:' || !x.hostname.includes('.')) return null;
    return x.origin + '/';
  } catch {
    return null;
  }
}

async function urlAlive(u) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000);
  try {
    const r = await fetch(u, {
      method: 'GET', redirect: 'follow', signal: ac.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BlogAutoPoster/1.0)' },
    });
    try { await r.body?.cancel?.(); } catch {}
    return (r.status >= 200 && r.status < 400) || [401, 403, 405, 429].includes(r.status);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// 공식 주소는 실제로 열리는 것만 사용, 아니면 네이버 검색 링크로 대체
async function resolveLinks(d) {
  const all = [];
  (d.sections || []).forEach((s) => {
    s.links = (Array.isArray(s.links) ? s.links : []).filter((l) => l && l.label && l.query).slice(0, 2);
    all.push(...s.links);
  });
  await Promise.all(
    all.map(async (l) => {
      const root = l.officialUrl ? toRoot(l.officialUrl) : null;
      if (root && (await urlAlive(root))) {
        l.url = root;
        l.kind = 'official';
      } else {
        l.url = 'https://search.naver.com/search.naver?query=' + encodeURIComponent(l.query);
        l.kind = 'search';
      }
      delete l.officialUrl;
    })
  );
  return d;
}

function normalize(d) {
  if (d.comparisonTable && Array.isArray(d.comparisonTable.rows)) {
    d.comparisonTable.rows = d.comparisonTable.rows.map((r) => (Array.isArray(r) ? r : r?.cells || []));
  }
  return d;
}

const OUTPUT_LANG = '한국어'; // 모든 국가 탭에서 글은 한국어로 작성 (필요하면 여기서 변경)

const CONCEPTS = {
  deep: {
    name: '심층 분석형',
    guide:
      '깊이 있는 정보 가이드. 배경·원인·방법·주의점을 논리적으로 풍부하게 설명(소제목당 450자 이상).',
  },
  summary: {
    name: '핵심 요약형',
    guide:
      '바쁜 현대인을 위한 요약형. 문장을 더 짧고 간결하게 쓰고 keyPoints를 특히 명확·구체적으로 작성(소제목당 본문 300자 이상).',
  },
  review: {
    name: '친근한 후기형',
    guide:
      '경험을 이야기하듯 풀어쓰는 구어체. "저도 처음엔~", "직접 찾아보니~" 같은 대화체. 단, 구체적인 수치·구매내역·방문기록 등 지어낸 개인 경험은 쓰지 말고 일반적인 공감 표현 위주로. Q&A를 풍부하게(4개).',
  },
  compare: {
    name: '정보 비교형',
    guide:
      '장단점 비교 중심. 반드시 comparisonTable(비교표)과 checklist(체크리스트)를 채울 것. 소제목 본문은 비교 기준과 선택 팁 중심으로 소제목당 300자 이상.',
  },
};

function bodyLength(d) {
  return (d.sections || []).reduce((n, s) => n + (s.body || []).join('').replace(/\s/g, '').length, 0);
}

function buildPrompt({ keyword, concept, today, retryNote, notes }) {
  const c = CONCEPTS[concept] || CONCEPTS.deep;
  const factsBlock = notes
    ? `\n[최신 조사 노트 - 오늘(${today}) 웹 검색으로 확인한 내용]\n${notes}\n- 수치·날짜·금액·조건·정책·제품 사양은 위 노트에 있는 내용만 사용할 것. 노트에 없는 구체적 숫자는 쓰지 말고 "공식 사이트에서 확인해 주세요"로 안내.\n- 노트에 '상충'이라고 표시된 정보는 단정하지 말고 "자료마다 달라 확인이 필요해요"라고 쓸 것.\n`
    : '';
  return `당신은 구글 SEO에 능숙한 티스토리 블로거입니다. 아래 키워드로 블로그 포스팅을 작성하세요.

[키워드] ${keyword}
[컨셉] ${c.name} — ${c.guide}
[오늘 날짜] ${today}
[언어] ${OUTPUT_LANG}

[말투]
- 전체적으로 친근한 여성형 말투 (예: ~해요, ~거든요, ~더라고요, ~드릴게요). 존댓말 유지, 과한 애교·이모티콘 남발은 금지.
[글 구조 - 기승전결]
- summary: 포스팅 전체의 줄거리를 3~4문장으로 (글의 시작 부분에 놓임)
- sections: 정확히 5개. 순서와 role은 기(도입·문제제기) → 승(핵심 정보 전개) → 승(심화·구체적 방법) → 전(반전·주의점·흔한 실수) → 결(정리·실행 가이드).
- heading(소제목)에는 '기·승·전·결' 같은 단어나 번호(1., ❶ 등)를 절대 넣지 말고, 한눈에 내용을 알 수 있게 구체적으로 쓸 것. oneLine은 그 소제목의 핵심을 한 줄로 요약(카드뉴스 문구처럼).
- qna: 독자가 실제로 궁금해할 질문 3~4개와 답변 (이목을 끄는 질문형)
- closing: 블로그 마무리 인사 2~3문장 (공감·감사, 다음 글 예고 느낌)
[카드뉴스형 가독성 - 반드시 지킬 것]
- 독자는 글을 읽지 않고 훑어봅니다. 훑기만 해도 핵심이 보이도록 작성.
- body 문단은 한 문단 2~3문장(공백 포함 120자 안팎)으로 짧게 끊고, 소제목당 4~5문단으로 나눌 것. 긴 덩어리 문단 금지.
- 각 문단에서 독자가 꼭 기억해야 할 핵심 구절 1~2개를 **이렇게** 별표 두 개로 감쌀 것 (문단 전체를 감싸지 말고 8~20자 구절만).
- keyPoints는 소제목당 정확히 3개. 각 항목은 {"title": 18자 이내의 핵심 키워드형 문구, "desc": 40자 이내의 한 줄 설명}.
- tip은 소제목당 1개, 60자 이내로 '이것만은 꼭!' 같은 실용 팁 또는 주의점 한 문장.
[링크 - 필요할 때만]
- 독자가 실제로 확인·신청·비교해야 하는 곳이 있을 때만 sections[].links에 넣을 것 (소제목당 0~2개, 글 전체 5개 이내). 필요 없으면 빈 배열 [].
- anchor: 해당 소제목 body 문장 안에 '그대로 들어 있는' 4~15자 한글 구절 (링크가 걸릴 자리). 적당한 구절이 없으면 빈 문자열.
- label: 버튼 문구 12자 이내 (예: "정부24 바로가기").
- query: 네이버에서 검색할 키워드 (예: "청년월세지원 신청방법").
- officialUrl: 정부·공공기관·기업의 공식 사이트 '메인 주소'(https://도메인/ 형태)를 확실히 알 때만. 하위 경로는 쓰지 말고, 조금이라도 불확실하면 null. 주소를 지어내지 말 것.
[사람이 쓴 글처럼]
- "~에 대해 알아보겠습니다", "결론적으로", "첫째/둘째/셋째" 반복, 모든 문장을 비슷한 길이로 쓰는 것 등 AI 티가 나는 표현을 피하고, 짧은 문장과 긴 문장을 섞고, 가끔 독자에게 질문을 던지며 자연스러운 말투로 쓸 것.
[분량 - 반드시 지킬 것]
- sections의 body 문단 전체 합계가 공백 제외 1,500자 이상(권장 2,000~2,500자). 소제목 하나당 최소 300자 이상.
- keyPoints, qna, summary, closing 글자 수는 이 합계에 포함되지 않음. 내용을 늘릴 때는 같은 말을 반복하지 말고 구체적인 설명·예시·주의점으로 채울 것.
[SEO]
- 제목 5개는 클릭을 부르되 과장·낚시 금지, 핵심 키워드를 앞쪽에 포함. 본문 첫 문단과 소제목에도 키워드를 자연스럽게 포함.
- meta는 120자 안팎의 메타 설명.
- tags는 핵심 키워드 정확히 10개 (#, 공백 없이).
[사실 규칙]
- 확인되지 않은 통계·수치·법령·정책 내용·출처를 지어내지 말 것. 불확실한 정보는 "최신 공식 공지를 꼭 확인해 주세요"처럼 안내.${factsBlock}
[이미지 장면]
- 각 섹션의 imageScene과 thumbnailScene에는 해당 내용을 상징하는 장면을 한 문장으로 묘사 (글자는 넣지 않는 그림 기준, 한국어).

[이미지 대체 텍스트(alt)]
- imageAlt, thumbnailAlt: 그림 내용을 설명하는 자연스러운 한 문장(15~40자). 핵심 키워드를 자연스럽게 1회만 포함하고 키워드 나열은 금지. '이미지', '사진'으로 시작하지 말 것.

[출력 형식] 아래 JSON 하나만 출력. 마크다운 코드블록·설명 금지.
{
  "titles": ["제목1","제목2","제목3","제목4","제목5"],
  "meta": "메타 설명",
  "tags": ["태그1", "... 총 10개"],
  "summary": "줄거리",
  "thumbnailScene": "대표 썸네일 장면 묘사",
  "thumbnailAlt": "대표 썸네일 대체 텍스트",
  "sections": [
    {
      "role": "기",
      "icon": "이모지 1개",
      "heading": "소제목",
      "oneLine": "한 줄 핵심 요약",
      "body": ["짧은 문단1 (핵심 **구절** 강조)", "짧은 문단2", "짧은 문단3", "짧은 문단4"],
      "keyPoints": [{ "title": "핵심 키워드", "desc": "한 줄 설명" }, { "title": "...", "desc": "..." }, { "title": "...", "desc": "..." }],
      "tip": "이것만은 꼭! 한 문장 팁",
      "links": [{ "anchor": "본문 속 구절", "label": "버튼 문구", "query": "검색 키워드", "officialUrl": null }],
      "imageScene": "이 소제목 장면 묘사",
      "imageAlt": "이 소제목 이미지의 대체 텍스트"
    }
  ],
  "comparisonTable": { "headers": ["항목","A","B"], "rows": [{ "cells": ["...","...","..."] }] },
  "checklist": ["체크 항목1", "체크 항목2"],
  "qna": [{ "q": "질문", "a": "답변" }],
  "closing": "마무리 인사"
}
- comparisonTable과 checklist는 '정보 비교형'일 때만 채우고, 다른 컨셉에서는 null로 두세요.${retryNote ? '\n\n[재작성 요청] ' + retryNote : ''}`;
}

function parseJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const s = cleaned.indexOf('{');
    const e = cleaned.lastIndexOf('}');
    if (s >= 0 && e > s) return JSON.parse(cleaned.slice(s, e + 1));
    throw new Error('AI 응답을 해석하지 못했습니다.');
  }
}

function validate(d) {
  const ok =
    d &&
    Array.isArray(d.titles) && d.titles.length >= 1 &&
    typeof d.summary === 'string' &&
    Array.isArray(d.sections) && d.sections.length >= 1 &&
    Array.isArray(d.tags) &&
    Array.isArray(d.qna);
  if (!ok) throw new Error('AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.');
  return d;
}

// 구글 검색 연동으로 최신 사실 조사 (실패해도 글 생성은 계속 진행)
async function research({ apiKey, kw, today }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 28000);
  try {
    const prompt = `오늘은 ${today}입니다. 웹 검색으로 "${kw}"에 대해 블로그 글 작성에 필요한 최신·정확한 사실을 조사해 한국어 노트로 정리하세요.
규칙:
- 검색으로 확인된 사실만 쓰고, 추측하지 말 것.
- 수치·날짜·금액·신청 조건·정책·제품 사양은 정확히 쓰고, 출처 기관/매체 이름을 함께 적을 것.
- 항목은 10개 이내, 항목당 1~2문장.
- 자료마다 내용이 다르면 둘 다 적고 '상충'이라고 표시할 것.
- 독자가 자주 묻는 질문 3개도 함께 정리할 것.
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
  if (need && req.headers['x-access-code'] !== need) {
    return res.status(401).json({ error: '접근코드가 올바르지 않습니다.' });
  }

  const { keyword, concept, grounding } = req.body || {};
  const useGrounding = grounding !== false && process.env.GROUNDING !== 'off';
  const kw = String(keyword || '').trim().slice(0, 100);
  if (!kw) return res.status(400).json({ error: '키워드를 입력해 주세요.' });

  const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' });

  const t0 = Date.now();
  let facts = null;

  async function callGemini(retryNote, useSchema = true) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: buildPrompt({ keyword: kw, concept, today, retryNote, notes: facts?.notes }) }] }],
          generationConfig: {
            temperature: 0.7,
            responseMimeType: 'application/json',
            maxOutputTokens: 16384,
            ...(useSchema ? { responseSchema: SCHEMA } : {}),
          },
        }),
      }
    );
    if (r.status === 429) {
      const err = new Error('무료 사용량 한도에 도달했어요. 잠시 후 다시 시도해 주세요.');
      err.status = 429;
      throw err;
    }
    if (r.status === 400 && useSchema) return callGemini(retryNote, false); // 스키마를 거부하면 스키마 없이 재시도
    if (!r.ok) {
      const t = await r.text();
      const err = new Error(`Gemini 오류 (${r.status}): ${t.slice(0, 200)}`);
      err.status = 502;
      throw err;
    }
    const j = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    if (!text) {
      const err = new Error('AI가 빈 응답을 보냈어요. 다시 시도해 주세요.');
      err.status = 502;
      throw err;
    }
    let parsed;
    try {
      parsed = parseJson(text);
    } catch (e) {
      const err = new Error('AI 응답 형식이 잠깐 깨졌어요. 다시 한 번 눌러 주세요.');
      err.status = 502;
      err.parse = true;
      throw err;
    }
    return normalize(validate(parsed));
  }

  async function callWithRetry(note) {
    try {
      return await callGemini(note);
    } catch (e) {
      if (e.parse) return await callGemini(note); // 형식 오류는 자동으로 한 번 더
      throw e;
    }
  }

  try {
    if (useGrounding) facts = await research({ apiKey, kw, today });
    let data = await callWithRetry('');
    let count = bodyLength(data);
    if (count < MIN_CHARS && Date.now() - t0 < 75000) {
      // 1500자 미만이면 한 번 더 길게 다시 작성
      try {
        const again = await callGemini(
          `이전 결과는 본문이 약 ${count}자로 부족했습니다. 각 소제목 본문을 더 구체적으로 풍부하게 써서 합계 2,000자 이상으로 다시 작성하세요.`
        );
        const c2 = bodyLength(again);
        if (c2 > count) { data = again; count = c2; }
      } catch (e) { /* 재시도 실패 시 첫 결과 사용 */ }
    }
    try { await resolveLinks(data); } catch { /* 링크 처리 실패해도 글은 그대로 전달 */ }
    return res.status(200).json({ data, keyword: kw, concept, charCount: count, grounded: !!facts, sources: facts?.sources || [] });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || '생성 중 오류가 발생했어요.' });
  }
};
