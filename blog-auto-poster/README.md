# 수익형 블로그 오토 포스터 (Vercel + Gemini)

## 폴더 구조
```
api/trends.js     구글 트렌드 실시간 Top10 (무료 RSS)
api/generate.js   Gemini로 포스팅 생성 (API 키는 서버에만)
public/index.html 화면 (PC/모바일 반응형)
vercel.json       생성 함수 최대 실행시간 60초
```

## 배포
1. 이 폴더 전체를 GitHub 저장소에 올리기 (기존 저장소가 있으면 파일 교체)
2. Vercel에서 해당 저장소 Import → Framework Preset은 **Other**
3. Settings → Environment Variables 등록
   - `GEMINI_API_KEY` : Google AI Studio에서 발급
   - `GEMINI_MODEL`   : (선택) 기본값 gemini-2.5-flash
   - `ACCESS_CODE`    : (선택) 내 비밀번호. 설정하면 코드를 아는 사람만 글 생성 가능
4. Redeploy

## 로컬 테스트
```
npm i -g vercel
vercel dev
```
