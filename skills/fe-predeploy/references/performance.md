# 성능 측정 — 검증 레시피

기준치는 config(`thresholds`)가 단일 출처다. 측정은 **프로덕션 빌드 + 시크릿 창 조건**(확장 프로그램·캐시 간섭 배제)이 원칙이고, 조건을 못 맞췄으면 결과에 명시한다.

## D1. Core Web Vitals (blocker — 기준치 초과 시)

- **왜**: LCP(체감 로딩)·CLS(레이아웃 밀림)·INP(입력 반응성)는 사용자 체감과 SEO에 직결된다.
- **방법 (서열 순)**:
  1. `npx lighthouse <URL> --output=json --quiet --chrome-flags="--headless"` — 규칙 기반, 최우선. JSON에서 지표 추출.
  2. lighthouse 불가 시: 브라우저에 PerformanceObserver 스니펫 주입으로 LCP·CLS 실측(INP는 인터랙션 후 판독).
- **판정**: config 기준(기본 LCP<2500ms, CLS<0.1, INP<200ms, performance 점수≥80). 초과 항목별로 수치를 기록.
- **주의**: 로컬 측정은 네트워크 변수를 못 잡는다 — 수치는 상대 비교(이전 점검 대비 회귀 감지) 용도가 크다는 것을 기록에 남긴다.

## D2. 번들 크기·코드 스플리팅 (warn)

- **왜**: 초기 JS가 크면 LCP·INP가 함께 나빠진다. 특히 라우트 전체가 한 청크면 스플리팅 실패 신호.
- **방법**: 빌드 산출물 크기 확인 — Next.js는 `next build` 출력의 라우트별 First Load JS, 그 외는 dist 내 .js 파일 크기 목록(`du`·`ls -la`). 번들 분석기가 설정돼 있으면 그것을 우선.
- **판정**: config `bundleBudgetKb`가 있으면 그 기준, 없으면 First Load JS가 비정상적으로 큰 라우트(수백 KB 단위 이상)를 후보로 기록.

## D3. 이미지 최적화 (warn)

- **왜**: 이미지가 LCP의 최다 원인이다. 크기 미명시는 CLS를 만든다.
- **방법**: lighthouse 감사 항목(modern formats, properly sized, lazy loading) + 정적 스캔의 `next-img-tag`(Next.js에서 `<img>` 직접 사용) 병합.
- **판정**: lighthouse 해당 감사 통과. viewport 밖 이미지 lazy loading, width/height(또는 aspect-ratio) 명시.

## D4. 과잉 리렌더 (warn)

- **왜**: 입력 한 번에 트리 전체가 다시 그려지면 INP가 나빠지고 배터리를 태운다.
- **방법**: 핵심 컴포넌트에 한해 렌더 카운터를 심을 수 있으면(개발 협조 필요) 인터랙션당 렌더 수 측정. 불가하면 INP 실측(D1)으로 갈음하고 skip 사유를 기록.
- **판정**: 단일 인터랙션에 무관한 영역의 렌더가 비례 증가하지 않는다. 계측 불가 시 INP 정상이면 pass로 갈음(그 사실 명시).

## D5. 리스트 가상화 (warn — 대량 데이터 화면이 있을 때만)

- **왜**: 수천 행을 그대로 그리면 DOM 노드 수가 INP·메모리를 무너뜨린다.
- **방법**: 대량 목록 화면에서 `document.querySelectorAll('*').length` 또는 목록 컨테이너의 자식 수 판독 → 스크롤 후 재판독.
- **판정**: 화면 밖 항목이 DOM에 전부 존재하지 않는다(가상화·페이지네이션·무한스크롤 중 하나가 있다). 해당 화면이 없으면 skip.
