// POST /api/generate  { keyword, concept, geo }  → 포스팅 구조화 JSON
// API 키는 Vercel 환경변수(GEMINI_API_KEY)에만 보관됩니다.

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MIN_CHARS = 1500; // 본문 최소 글자 수(공백 제외)
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

function buildPrompt({ keyword, concept, today, retryNote }) {
  const c = CONCEPTS[concept] || CONCEPTS.deep;
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
- 확인되지 않은 통계·수치·법령·정책 내용·출처를 지어내지 말 것. 불확실한 정보는 "최신 공식 공지를 꼭 확인해 주세요"처럼 안내.
[이미지 장면]
- 각 섹션의 imageScene과 thumbnailScene에는 해당 내용을 상징하는 장면을 한 문장으로 묘사 (글자는 넣지 않는 그림 기준, 한국어).

[출력 형식] 아래 JSON 하나만 출력. 마크다운 코드블록·설명 금지.
{
  "titles": ["제목1","제목2","제목3","제목4","제목5"],
  "meta": "메타 설명",
  "tags": ["태그1", "... 총 10개"],
  "summary": "줄거리",
  "thumbnailScene": "대표 썸네일 장면 묘사",
  "sections": [
    {
      "role": "기",
      "icon": "이모지 1개",
      "heading": "소제목",
      "oneLine": "한 줄 핵심 요약",
      "body": ["짧은 문단1 (핵심 **구절** 강조)", "짧은 문단2", "짧은 문단3", "짧은 문단4"],
      "keyPoints": [{ "title": "핵심 키워드", "desc": "한 줄 설명" }, { "title": "...", "desc": "..." }, { "title": "...", "desc": "..." }],
      "tip": "이것만은 꼭! 한 문장 팁",
      "imageScene": "이 소제목 장면 묘사"
    }
  ],
  "comparisonTable": { "headers": ["항목","A","B"], "rows": [["...","...","..."]] },
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

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 지원합니다.' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: '서버에 GEMINI_API_KEY가 설정되지 않았습니다.' });

  const need = process.env.ACCESS_CODE;
  if (need && req.headers['x-access-code'] !== need) {
    return res.status(401).json({ error: '접근코드가 올바르지 않습니다.' });
  }

  const { keyword, concept } = req.body || {};
  const kw = String(keyword || '').trim().slice(0, 100);
  if (!kw) return res.status(400).json({ error: '키워드를 입력해 주세요.' });

  const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' });

  async function callGemini(retryNote) {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: buildPrompt({ keyword: kw, concept, today, retryNote }) }] }],
          generationConfig: { temperature: 0.8, responseMimeType: 'application/json', maxOutputTokens: 16384 },
        }),
      }
    );
    if (r.status === 429) {
      const err = new Error('무료 사용량 한도에 도달했어요. 잠시 후 다시 시도해 주세요.');
      err.status = 429;
      throw err;
    }
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
    return validate(parseJson(text));
  }

  try {
    let data = await callGemini('');
    let count = bodyLength(data);
    if (count < MIN_CHARS) {
      // 1500자 미만이면 한 번 더 길게 다시 작성
      try {
        const again = await callGemini(
          `이전 결과는 본문이 약 ${count}자로 부족했습니다. 각 소제목 본문을 더 구체적으로 풍부하게 써서 합계 2,000자 이상으로 다시 작성하세요.`
        );
        const c2 = bodyLength(again);
        if (c2 > count) { data = again; count = c2; }
      } catch (e) { /* 재시도 실패 시 첫 결과 사용 */ }
    }
    return res.status(200).json({ data, keyword: kw, concept, charCount: count });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message || '생성 중 오류가 발생했어요.' });
  }
};
