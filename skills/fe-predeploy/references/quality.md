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
