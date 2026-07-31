# 복원력 — 배포·네트워크·세션·렌더링 실패 대응

"정상 경로"가 아니라 **실패·경계 상황에서 앱이 살아남는가**를 본다. 이 카테고리의 항목 다수가 실제 기업 장애 사례에서 나왔다 — 출처를 병기한다.

## R1. 배포 버전 스큐 — ChunkLoadError (blocker)

- **왜**: 새 배포로 청크 해시가 바뀌면 이미 열려 있던 탭이 사라진 청크를 요청하다 죽는다. 우아한형제들 Sentry 운영 글에서 실수집된 주요 에러로 명시(techblog.woowahan.com/21604), Vercel은 Skew Protection·Next `deploymentId`를 공식 대응책으로 제공.
- **방법**: 코드 리뷰 — lazy import 경계의 ErrorBoundary + 청크 로드 실패 시 1회 제한 자동 새로고침 폴백, Next면 `deploymentId` 설정. 실측은 탭을 열어둔 채 재배포 후 라우트 이동.
- **판정**: 폴백 존재(리뷰) 또는 구버전 탭에서 라우트 이동이 흰 화면 없이 복구된다.

## R2. fetch 에러 판정 — response.ok (blocker)

- **왜**: fetch는 4xx/5xx에서 reject되지 않는다 — `.ok` 검사가 없으면 에러 응답이 성공 경로로 흐른다. 네트워크 실패(TypeError)·HTML을 json 파싱(SyntaxError)과 세 갈래 구분이 필요하다(web.dev/articles/fetch-api-error-handling).
- **방법**: 정적 스캔 `fetch-no-ok-check` → 각 지점 코드 확인.
- **판정**: fetch 사용처마다 ok 검사(또는 공통 래퍼 경유)가 있다.

## R3. Error Boundary — 흰 화면 방지 (blocker) · 커스텀 404 (warn)

- **왜**: React는 렌더 중 에러가 나면 **UI 전체를 제거한다** — 경계가 없으면 통짜 흰 화면이다(react.dev Component#error-boundaries). Next.js 프로덕션 체크리스트는 `global-error`·커스텀 not-found를 명시.
- **방법**: 코드 리뷰(라우트 트리에 경계 존재, Next면 `error.tsx`/`global-error.tsx`/`not-found.tsx`) + 브라우저에서 존재하지 않는 경로 진입(404), 가능하면 강제 throw로 폴백 확인.
- **판정**: 경계 존재 + 404가 내비게이션 있는 커스텀 페이지. 주의: Error Boundary는 이벤트 핸들러·비동기 콜백 에러를 못 잡는다 — 그쪽은 전역 `onerror`/`unhandledrejection` 처리 여부를 본다.

## R4. 서드파티 스크립트 SPOF (blocker)

- **왜**: 분석·채팅·광고 스크립트 서버가 느려지면 앱 전체가 멎을 수 있다 — async/defer로도 안 막히는 경우가 있다(web.dev 서드파티 JS 가이드). 판정 기준은 "그 스크립트가 죽어도 핵심 기능이 사는가".
- **방법**: DevTools Network request blocking으로 서드파티 도메인 차단 → 핵심 플로우 재실행. 정적으로는 외부 `<script src>`의 async/defer·SRI(integrity) 누락 확인.
- **판정**: 서드파티 차단 상태에서 핵심 플로우 완주 가능.

## R5. 오프라인·저속 네트워크 (warn)

- **왜**: 연결 실패는 완전 오프라인만이 아니다. 상태 표시(색만 쓰지 말 것)·그 상태에서 가능한 행동 안내·오프라인 작업의 큐잉이 가이드라인이다(web.dev/offline-ux-design-guidelines).
- **방법**: DevTools Network throttling(Offline·Slow 4G)에서 폼 제출·목록 로드 재현.
- **판정**: 오프라인 제출이 데이터를 소실하지 않고(에러 안내 또는 큐), 저속에서 로딩 표시가 유지된다.

## R6. bfcache — 복원 상태·차단 요인 (blocker/warn)

- **왜**: 뒤로가기로 복원된 페이지는 새로 로드되지 않는다 — 로그인 상태·잔액 같은 민감 데이터가 옛 화면 그대로 노출된 사례가 문서에 직접 언급된다(web.dev/articles/bfcache). `unload` 리스너·`Cache-Control: no-store`는 bfcache를 통째로 끈다.
- **방법**: 상태 갱신 — 코드 리뷰로 `pageshow`에서 `event.persisted` 분기 확인 + 브라우저에서 로그아웃 → 뒤로가기로 민감 화면 복원 시도(blocker). 차단 요인 — 정적 스캔 `unload-listener` + DevTools Application → Back-forward Cache 테스트(warn).
- **판정**: 복원 시 민감·휘발성 데이터가 갱신된다. unload 리스너 0건.

## R7. 토큰 리프레시 동시성 (blocker)

- **왜**: 401을 동시에 받은 요청들이 리프레시를 중복 발사하면, 토큰 로테이션 서버에서는 나중 요청이 폐기된 토큰을 보내 **전체 세션이 강제 로그아웃**된다. (일반 실무 지식 — 국내 다수 사례 글 존재)
- **방법**: 코드 리뷰 — 인터셉터의 리프레시 호출이 단일 Promise 캐싱/뮤텍스로 직렬화되는지. 실측은 토큰 만료 후 API 다중 호출 화면 진입 → 네트워크 탭에서 리프레시 요청 수.
- **판정**: 동시 401에서 리프레시 요청 **1건**.

## R8. 멀티탭·멀티 웹뷰 상태 동기화 (로그아웃 전파=blocker, 일반 데이터=warn)

- **왜**: 한 탭에서 로그아웃했는데 다른 탭이 로그인 상태로 남으면 보안 문제다. 웹뷰 여러 장이 뜨는 앱에서 장바구니·찜 불일치도 같은 축이다(비브로스 웹뷰 개선기 — BroadcastChannel 검토 사례).
- **방법**: 탭 2개 → 한쪽 로그아웃 → 다른 탭에서 보호된 액션 시도.
- **판정**: 다른 탭의 보호 액션이 차단(리다이렉트·안내)된다.

## R9. 브라우저 타깃·폴리필 갭 (blocker)

- **왜**: 배민 장바구니 웹뷰가 폴리필 설정 누락으로 구형 브라우저에서 **백지 화면**(약 1만 명 영향, techblog.woowahan.com/17710). Safari 12처럼 "모던"으로 분류되지만 특정 API(ResizeObserver 등)가 빠진 회색지대가 함정이다(toss.tech/article/smart-polyfills).
- **방법**: browserslist·빌드 타깃 확인 → 소스의 최신 API 사용(`at`·`fromEntries`·`structuredClone`·`findLast`·ResizeObserver)과 대조. 지원 하한 브라우저(또는 UA 에뮬레이션)로 첫 화면 로드.
- **판정**: 선언된 지원 범위의 하한에서 백지 없이 렌더된다.

## R10. 에러 모니터링 노이즈 (warn)

- **왜**: Sentry rate limit로 에러의 80%가 유실되고 장애를 고객센터 문의로 인지한 사례(techblog.woowahan.com/21604). 노이즈(`Failed to fetch`, 처리 완료된 4xx)가 한도를 잡아먹으면 진짜 장애가 묻힌다.
- **방법**: 코드 리뷰 — 모니터링 초기화의 `ignoreErrors`/`beforeSend` 필터, level 구분, 핑거프린트 설정. 모니터링이 아예 없으면 그 사실을 기록.
- **판정**: 노이즈 필터가 존재하고, 핵심 플로우의 의도적 에러(테스트 중 발생분)가 실제로 수집된다.

## R11. Hydration mismatch — Next.js SSR (blocker)

- **왜**: 서버·클라이언트 렌더 불일치는 프로덕션에서 조용히 넘어가며, 최악엔 **이벤트 핸들러가 엉뚱한 엘리먼트에 붙는다**(react.dev hydrateRoot 문서). 주범: `Date.now()`/`Math.random()`, `typeof window` 분기, 로케일·타임존 포맷팅(정적 스캔 `date-locale-implicit`과 연결).
- **방법**: `next build && next start`로 띄운 뒤 주요 페이지 진입 → 콘솔 hydration 경고 0건 확인 + 위 패턴 코드 검색. `suppressHydrationWarning` 남용(한 단계만 동작하는 탈출구) 확인.
- **판정**: 프로덕션 빌드에서 hydration 경고·에러 0건.
