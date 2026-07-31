# 모바일 브라우저·웹뷰 — 검증 레시피

데스크톱 Chrome에서 통과해도 iOS Safari·안드로이드 웹뷰에서 깨지는 항목들이다. 브라우저 도구는 뷰포트·UA 에뮬레이션까지만 가능하므로, **에뮬레이션으로 판정 불가한 항목은 skip(사유: 실기기 필요)으로 분류하고 실기기 확인 목록을 사용자 검토로 넘긴다.**

## M1. iOS input 자동 확대 — font-size 16px 미만 (warn)

- **왜**: input 폰트가 16px 미만이면 포커스 시 화면이 자동 확대돼 레이아웃이 깨진다(비브로스 웹뷰 개선기). `maximum-scale=1`로 막는 우회는 접근성 확대까지 막으므로 폰트 크기 자체를 16px 이상으로.
- **방법**: 모바일 뷰포트에서 input/textarea/select의 computed font-size 판독(`getComputedStyle`).
- **판정**: 폼 필드 전부 16px 이상. `maximum-scale=1` 사용 시 사용자 검토로 분류(접근성 트레이드오프).

## M2. 100vh·safe-area (warn)

- **왜**: iOS Safari의 100vh는 주소창 높이를 포함해 하단이 잘리고, 노치 기기에서 하단 고정 버튼이 홈 인디케이터에 가린다. 표준 해법은 `dvh`와 `env(safe-area-inset-*)`.
- **방법**: 정적 스캔 `vh-100` + `position: fixed; bottom: 0` 요소의 safe-area padding·viewport 메타 `viewport-fit=cover` 확인. 모바일 뷰포트에서 하단 고정 요소 스크린샷.
- **판정**: 전체 높이 레이아웃이 dvh(또는 JS 보정)를 쓰고, 하단 고정 요소가 safe-area를 고려한다.

## M3. 안드로이드 물리 백버튼 × 모달·바텀시트 (blocker)

- **왜**: 안드로이드 사용자는 바텀시트를 물리 뒤로가기로 닫는다 — 모달이 히스토리에 없으면 뒤로가기가 **페이지 이탈**이 되어 작성 중 입력이 소실된다. 비브로스는 hash 라우팅으로 바텀시트를 히스토리에 태워 해결(OS별로 처리가 갈림 — iOS는 제스처 애니메이션 충돌 때문에 replace 사용).
- **방법**: 모달·바텀시트를 연 상태에서 브라우저 뒤로가기 실행.
- **판정**: 모달만 닫히고 페이지는 유지된다.

## M4. iOS 미디어 자동재생 정책 (warn)

- **왜**: 모바일 Safari는 유저 인터랙션 없이 비디오를 재생하지 않는다 — 토스 Simplicity 4 제작기에서 우회 실패 후 UX 자체를 변경한 사례.
- **방법**: 코드 리뷰 — `<video>`에 `muted playsinline` 동시 지정, `play()` Promise reject 처리. 자동재생에 의존한 핵심 UX가 있는지 확인.
- **판정**: 자동재생 실패가 UI를 깨뜨리지 않는다(폴백 또는 인터랙션 시작).

## M5. Safari 렌더링·성능 함정 — blur·border-radius (warn)

- **왜**: `backdrop-filter`/blur는 Safari에서 뚜렷한 프레임 저하를 만들고(토스 Simplicity 4), border-radius는 overflow와 겹칠 때 webkit 버그로 미적용될 수 있다(`isolation: isolate`로 부분 해결 — 비브로스).
- **방법**: 정적 스캔으로 blur·backdrop-filter 사용처 목록화 → 스크롤·애니메이션 영역과 겹치면 실기기 확인 목록으로.
- **판정**: 에뮬레이션 판정 불가 — 사용처 목록과 함께 skip(사유: 실기기 필요)로 분류.

## M6. 터치 타깃 크기·간격 (warn)

- **왜**: 최소 48dp(약 9mm), 타깃 간 8px 이상이 공식 기준(web.dev/accessible-tap-targets). 뷰포트 폭이 아니라 `@media (any-pointer: coarse)`로 터치를 감지하라는 권고 포함.
- **방법**: 모바일 뷰포트에서 핵심 플로우의 버튼·링크 박스 크기 판독(`getBoundingClientRect`). lighthouse 접근성 감사(tap targets) 병용. 기준치는 config `thresholds.touchTargetPx`(기본 48).
- **판정**: 핵심 인터랙션 요소가 48×48px 이상(패딩 포함).

## M7. 웹뷰 디버깅 가능성 (warn — 웹뷰 서빙 화면이 있을 때만)

- **왜**: 웹뷰는 개발자 도구가 막혀 "제 기기에선 되는데요"가 재현 불가 지옥이 된다 — 우아한형제들은 원격 디버깅 툴을 자체 개발했을 정도(techblog.woowahan.com/23343).
- **방법**: 코드 리뷰 — 웹뷰 화면에 에러 리포팅(사용자 식별자·화면 경로·직전 API 응답 포함)이 붙어 있는지, R10(모니터링)과 연결.
- **판정**: 웹뷰 화면의 에러가 사후 추적 가능한 형태로 수집된다. 웹뷰 미사용 프로젝트는 skip.
