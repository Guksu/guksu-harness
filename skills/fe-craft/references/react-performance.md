# React/Next.js 성능 규칙 — 우선순위 인덱스

> **출처**: Vercel Engineering의 [`react-best-practices`](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices) 스킬(SKILL.md frontmatter에 MIT 선언, author: vercel, v1.0.0)의 규칙 인덱스를 한국어로 증류한 스냅샷(2026-08-05)이다. 라이선스는 `../LICENSES.md`. **규칙별 상세 설명·정오 코드 예시는 업스트림 `rules/{규칙명}.md`에 있다** — 규칙 적용이 확실치 않을 때만 해당 규칙 파일을 WebFetch로 가져와 확인한다.

70개 규칙, 8개 카테고리, 영향도순. 코드 작성·리뷰·리팩토링 시 위 카테고리(CRITICAL)부터 점검한다.

## 1. 워터폴 제거 (CRITICAL, `async-`)

- `async-cheap-condition-before-await` — 싼 동기 조건을 await보다 먼저 검사
- `async-defer-await` — await를 실제 사용하는 분기 안으로 이동
- `async-parallel` — 독립 작업은 `Promise.all()`로 병렬화
- `async-dependencies` — 부분 의존은 better-all 패턴으로
- `async-api-routes` — API 라우트에서 프로미스는 일찍 시작, await는 늦게
- `async-suspense-boundaries` — Suspense로 콘텐츠 스트리밍

## 2. 번들 크기 (CRITICAL, `bundle-`)

- `bundle-barrel-imports` — 배럴 파일 대신 직접 임포트
- `bundle-analyzable-paths` — 정적 분석 가능한 임포트·파일 경로 유지
- `bundle-dynamic-imports` — 무거운 컴포넌트는 `next/dynamic`
- `bundle-defer-third-party` — 애널리틱스·로깅은 하이드레이션 후 로드
- `bundle-conditional` — 기능 활성 시에만 모듈 로드
- `bundle-preload` — hover/focus 시 프리로드로 체감 속도 확보

## 3. 서버 사이드 (HIGH, `server-`)

- `server-auth-actions` — 서버 액션도 API 라우트처럼 인증
- `server-cache-react` — 요청 내 중복 제거는 `React.cache()`
- `server-cache-lru` — 요청 간 캐시는 LRU
- `server-dedup-props` — RSC props 중복 직렬화 회피
- `server-hoist-static-io` — 정적 I/O(폰트·로고)는 모듈 레벨로 호이스트
- `server-no-shared-module-state` — RSC/SSR에서 모듈 레벨 가변 요청 상태 금지
- `server-serialization` — 클라이언트 컴포넌트로 넘기는 데이터 최소화
- `server-parallel-fetching` — 컴포넌트 구조를 바꿔 fetch 병렬화
- `server-parallel-nested-fetching` — 항목별 중첩 fetch는 Promise.all 안에서 체인
- `server-after-nonblocking` — 논블로킹 작업은 `after()`

## 4. 클라이언트 데이터 페칭 (MEDIUM-HIGH, `client-`)

- `client-swr-dedup` — SWR로 요청 자동 중복 제거
- `client-event-listeners` — 전역 이벤트 리스너 중복 제거
- `client-passive-event-listeners` — 스크롤은 passive 리스너
- `client-localstorage-schema` — localStorage 데이터 버저닝·최소화

## 5. 리렌더 최적화 (MEDIUM, `rerender-`)

- `rerender-defer-reads` — 콜백에서만 쓰는 상태는 구독하지 않기
- `rerender-memo` — 비싼 작업은 메모이즈된 컴포넌트로 추출
- `rerender-memo-with-default-value` — 비원시 기본 props는 호이스트
- `rerender-dependencies` — effect 의존성은 원시값으로
- `rerender-derived-state` — 원시값 대신 파생 불리언 구독
- `rerender-derived-state-no-effect` — 파생 상태는 effect가 아니라 렌더 중 계산
- `rerender-functional-setstate` — 안정적 콜백엔 함수형 setState
- `rerender-lazy-state-init` — 비싼 초기값은 useState에 함수 전달
- `rerender-simple-expression-in-memo` — 단순 원시값에 memo 금지
- `rerender-split-combined-hooks` — 독립 의존성 훅은 분리
- `rerender-move-effect-to-event` — 상호작용 로직은 이벤트 핸들러로
- `rerender-transitions` — 급하지 않은 갱신은 `startTransition`
- `rerender-use-deferred-value` — 비싼 렌더는 지연시켜 입력 반응성 유지
- `rerender-use-ref-transient-values` — 일시적 고빈도 값은 ref
- `rerender-no-inline-components` — 컴포넌트 안에서 컴포넌트 정의 금지

## 6. 렌더링 성능 (MEDIUM, `rendering-`)

- `rendering-animate-svg-wrapper` — SVG 대신 감싼 div를 애니메이션
- `rendering-content-visibility` — 긴 리스트는 `content-visibility`
- `rendering-hoist-jsx` — 정적 JSX는 컴포넌트 밖으로
- `rendering-svg-precision` — SVG 좌표 정밀도 축소
- `rendering-hydration-no-flicker` — 클라이언트 전용 데이터는 인라인 스크립트로
- `rendering-hydration-suppress-warning` — 예상된 불일치는 경고 억제
- `rendering-activity` — 표시/숨김은 Activity 컴포넌트
- `rendering-conditional-render` — 조건부 렌더는 `&&` 대신 삼항
- `rendering-usetransition-loading` — 로딩 상태는 useTransition 우선
- `rendering-resource-hints` — 프리로딩은 React DOM 리소스 힌트
- `rendering-script-defer-async` — script 태그엔 defer/async

## 7. JavaScript 성능 (LOW-MEDIUM, `js-`)

- `js-batch-dom-css` — CSS 변경은 클래스·cssText로 묶기
- `js-index-maps` — 반복 조회는 Map 구축
- `js-cache-property-access` — 루프 안 객체 프로퍼티 캐싱
- `js-cache-function-results` — 함수 결과는 모듈 레벨 Map에 캐싱
- `js-cache-storage` — localStorage/sessionStorage 읽기 캐싱
- `js-combine-iterations` — filter/map 연쇄는 한 루프로
- `js-length-check-first` — 비싼 비교 전 배열 길이 먼저
- `js-early-exit` — 함수는 조기 반환
- `js-hoist-regexp` — RegExp 생성은 루프 밖으로
- `js-min-max-loop` — 최솟값·최댓값은 sort 말고 루프
- `js-set-map-lookups` — O(1) 조회는 Set/Map
- `js-tosorted-immutable` — 불변 정렬은 `toSorted()`
- `js-flatmap-filter` — map+filter는 flatMap 한 번에
- `js-request-idle-callback` — 비핵심 작업은 브라우저 유휴 시간으로

## 8. 고급 패턴 (LOW, `advanced-`)

- `advanced-effect-event-deps` — `useEffectEvent` 결과를 effect 의존성에 넣지 않기
- `advanced-event-handler-refs` — 이벤트 핸들러는 ref에 보관
- `advanced-init-once` — 앱 초기화는 로드당 1회
- `advanced-use-latest` — 안정적 콜백 ref는 useLatest

## 적용 방법

- **리뷰 시**: CRITICAL(워터폴·번들)부터 훑고, 발견은 규칙명을 근거로 Before/After/Why 표에 담는다(SKILL.md 출력 형식).
- **작성 시**: 데이터 페칭 코드는 1·3·4장, 컴포넌트 상태 설계는 5장을 먼저 점검한다.
- **fe-predeploy와의 관계**: 여기 규칙은 제작 중 코드 품질용이다. 배포 게이트의 성능 측정(Web Vitals·lighthouse)은 fe-predeploy가 담당한다 — 게이트에서 LCP·INP가 미달하면 이 문서의 CRITICAL 규칙 위반을 첫 용의자로 본다.
