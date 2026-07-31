# 품질 기본기 · 배포 설정 — 검증 레시피

## E. 품질 기본기

### E1. 콘솔 에러·경고 0건 (에러=blocker, 경고=warn)

- **왜**: 콘솔 에러는 대부분 실제 버그의 표면이고, 사용자 환경에서만 터지는 문제의 조기 신호다.
- **방법**: 모든 점검 플로우를 통과하는 동안 `read_console_messages`(pattern으로 error 필터) + 계측 스니펫의 `consoleErrors` 수집.
- **판정**: 에러 0건. 서드파티 스크립트 등 프로젝트가 통제 불가한 에러는 출처를 명시하고 제외 사유를 기록.

### E2. 반응형 스윕 (warn)

- **왜**: 데스크톱에서만 확인하고 배포하면 모바일 레이아웃 깨짐은 사용자가 먼저 발견한다.
- **방법**: config `viewports`(기본 mobile 390·tablet 768·desktop 1440)로 `resize_window` → 핵심 플로우 페이지별 스크린샷 → 가로 스크롤 발생(`document.documentElement.scrollWidth > innerWidth`)은 기계 판정, 레이아웃 이상은 스크린샷 근거로 **사용자 검토** 분류.
- **판정**: 가로 오버플로 0건(기계). 시각적 이상은 단정하지 않고 스크린샷과 함께 검토 목록으로.

### E3. 키보드·포커스 (warn)

- **왜**: 마우스 없이 조작 불가한 폼·모달은 접근성 이전에 기능 결함이다.
- **방법**: Tab 순회로 핵심 플로우 완주 시도, 모달 열림 시 포커스 이동·닫힘 시 복귀·배경 포커스 탈출(포커스 트랩) 확인.
- **판정**: 핵심 플로우가 키보드만으로 완주 가능, 모달 포커스 트랩 동작.

### E4. 스크린리더 기본 (warn)

- **방법**: lighthouse accessibility 감사(config 기준 점수, 기본 ≥90) + 핵심 폼의 label 연결, 이미지 alt, 아이콘 버튼 `aria-label` DOM 판독.
- **판정**: 점수 기준 통과 + 핵심 플로우 요소의 누락 0건.

### E5. 접근성 나머지 필수 — 색 대비·lang·스킵 링크·라이브 리전 (warn)

- **왜**: Front-End Checklist(thedaviddias)의 필수 항목 중 E1~E4에 안 들어간 것들. 색 대비 미달·`<html lang>` 누락은 lighthouse가 기계적으로 잡는다.
- **방법**: lighthouse/axe 감사(색 대비, lang, heading 순서) + 코드 리뷰(스킵 링크, 동적 콘텐츠 변경 알림용 ARIA 라이브 리전).
- **판정**: lighthouse 접근성 감사의 해당 항목 통과. 스킵 링크·라이브 리전은 코드 확인으로 pass/skip.

### E6. prefers-reduced-motion (warn)

- **왜**: 전정기관 장애 사용자에게 패럴랙스·큰 이동 애니메이션은 어지러움·구역질을 유발한다(web.dev/prefers-reduced-motion). 장식적 모션은 reduce 설정에서 꺼야 한다.
- **방법**: 정적 스캔 결과 애니메이션·트랜지션이 존재하는데 프로젝트 전체에 `prefers-reduced-motion` 미디어 쿼리가 0건이면 지적. DevTools Rendering 패널 emulate로 실동작 확인.
- **판정**: 큰 모션이 있는 프로젝트에 reduce 대응이 존재한다. 모션이 거의 없으면 skip.

## F. 배포 설정 안전

### F1. 디버그 잔재 (console.log=warn, debugger=blocker)

- **방법**: 정적 스캔 결과를 그대로 사용 (`console-log`·`debugger`).
- **판정**: debugger 0건(blocker). console.log는 개수를 기록하고 제거를 권고.

### F2. 번들 시크릿 노출 (blocker)

- **왜**: 클라이언트 번들에 들어간 키는 전 세계에 공개된 것이다. 절대 규칙 6의 프론트엔드 확장판.
- **방법**: 정적 스캔 `secret-literal`(소스) + Next.js는 `env-secret-client`('use client'의 비공개 env). 빌드 산출물이 있으면 대표 패턴(sk_live_·AKIA 등)을 산출물 대상으로도 grep — **매칭 위치만 기록하고 값은 옮겨 적지 않는다**.
- **판정**: 소스·산출물 모두 0건.

### F3. 소스맵 배포 정책 (warn)

- **왜**: 프로덕션 소스맵 공개는 소스 전체 공개와 같다 — 의도한 정책인지 확인이 필요하다.
- **방법**: 빌드 산출물의 `.map` 파일 존재와 배포 포함 여부 확인 (Next.js `productionBrowserSourceMaps` 설정 확인).
- **판정**: 정책이 명시돼 있고 산출물이 그와 일치. 정책이 없으면 사용자 검토로 분류.

### F4. 메타·SEO 기본 (warn — 공개 사이트일 때만)

- **방법**: 핵심 페이지의 `<title>`·description·og 태그·favicon DOM 판독. lighthouse SEO 감사 병용.
- **판정**: 핵심 페이지에 title·description 존재. 내부 도구·비공개 앱이면 skip(사유: 비공개).

### F5. CSP·보안 응답 헤더 (warn — 인증·결제 화면이면 blocker)

- **왜**: CSP는 XSS의 1차 방어선이고 `frame-ancestors`로 클릭재킹까지 막는다. 함정: `unsafe-inline`/`unsafe-eval`을 넣는 순간 방어가 무력화된다 — nonce 기반이 권장(MDN CSP 가이드, Next.js 프로덕션 체크리스트).
- **방법**: `curl -I <URL>`로 응답 헤더 확인 + 브라우저 콘솔의 CSP 위반 로그 + lighthouse Best Practices 감사. 신규 도입은 Report-Only부터.
- **판정**: CSP 존재 여부와 unsafe-* 사용을 기록. 없으면 사용자 검토(도입 여부는 정책 결정)로 분류.

### F6. DOM XSS 싱크 (blocker)

- **왜**: `innerHTML`·`document.write`·`eval`·문자열 `setTimeout`·`javascript:` href가 사용자 입력과 만나면 XSS다(OWASP DOM XSS Prevention). 기존 `dangerous-html`(dangerouslySetInnerHTML)과 같은 축.
- **방법**: 정적 스캔(`dangerous-html`) + 위 싱크 심볼 grep → 각 지점의 **데이터 출처가 사용자 입력인지** 코드 리뷰. sanitize(DOMPurify 등) 여부 확인.
- **판정**: 사용자 입력이 sanitize 없이 싱크에 도달하는 경로 0건.

### F7. tabnabbing — noopener (warn)

- **왜**: `target="_blank"`로 연 페이지가 `window.opener`로 원래 탭을 피싱 페이지로 바꿔치기할 수 있다(OWASP Reverse Tabnabbing). 모던 브라우저는 _blank에 noopener를 암묵 적용하지만 **`window.open()` 직접 호출은 대상이 아니다**.
- **방법**: 정적 스캔 `blank-no-noopener`.
- **판정**: window.open 호출부에 noopener 명시. _blank 앵커는 구형 브라우저 지원 범위에 따라 판단.

### F8. 파일 업로드 검증 (warn — 업로드 기능이 있을 때만)

- **왜**: 확장자는 allowlist로, 파일명은 재생성, 크기 상한 필수(OWASP File Upload). 클라이언트 검증은 UX용일 뿐 서버 검증을 대체하지 않는다.
- **방법**: 브라우저에서 초대형 파일·허용 외 확장자 업로드 시도 → 사용자에게 보이는 에러 확인 + 코드 리뷰(allowlist 방식인지).
- **판정**: 크기 초과·형식 불일치가 업로드 전에 명확한 에러로 표시된다. 업로드 기능이 없으면 skip.

### F9. 폼 자동완성·input 타입 (warn)

- **왜**: `autocomplete="username"/"current-password"/"new-password"`가 없으면 비밀번호 매니저가 동작하지 않는다(web.dev sign-in form best practices). name/id가 배포마다 바뀌는 해시면 자동완성이 깨진다. 증감 아닌 값(PIN·카드번호)에 `type="number"` 금지 — `inputmode="numeric"` 사용.
- **방법**: 로그인·가입 폼의 autocomplete·type·inputmode 속성 DOM 판독 + 브라우저 자동완성 실동작.
- **판정**: 인증 폼에 autocomplete 명시, 모바일 키보드 타입 적절(email/tel/numeric).

### F10. 날짜·로케일·타임존 (warn — 예약·정산·마감 화면이면 blocker)

- **왜**: 무인자 `toLocaleString`류는 런타임 로케일·시스템 타임존을 따라 사용자마다 다르게 찍히고 SSR에서 hydration mismatch(resilience R11)를 직접 유발한다(MDN Intl.DateTimeFormat). 타임존 없는 문자열(`"2026-07-31"`) 파싱은 브라우저마다 UTC/로컬 해석이 갈리고, 자정 근처 날짜는 하루씩 밀린다(KST 자정 = 전날 15:00 UTC).
- **방법**: 정적 스캔 `date-locale-implicit` + `new Date(문자열)` 직접 파싱 검색. 실측은 시스템 타임존을 바꿔(DevTools Sensors → Location/Timezone override) 날짜 표시 비교.
- **판정**: 포맷팅에 locale·timeZone이 명시돼 있고, 타임존을 바꿔도 의미가 유지된다.
