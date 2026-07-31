# 브라우저 조작 공통 레시피 — claude-in-chrome

런타임 계측(Phase 2~3)의 공통 절차. 도구가 없으면 해당 항목은 skip 처리하고 정적 게이트만의 부분 판정임을 기록한다.

## 1. 도구 로딩 — 한 번에

도구가 지연 로딩 상태면 ToolSearch **한 번**에 필요한 것을 전부 로드한다 (한 개씩 로드 금지):

```
ToolSearch "select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__read_network_requests,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__resize_window,mcp__claude-in-chrome__form_input"
```

세션 시작 시 `tabs_context_mcp`를 먼저 호출하고, 점검용 탭은 **새로 만든다**(기존 탭 재사용은 사용자가 지정했을 때만).

## 2. 계측 주입 절차

1. 대상 페이지로 `navigate`.
2. `scripts/instrument.js` 파일 내용을 읽어 `javascript_tool`로 평가한다(플레인 스크립트라 그대로 실행 가능).
3. 주입 확인: `!!window.__fePredeploy` → true.
4. **페이지 이동·새로고침은 계측을 지운다** — SPA 클라이언트 라우팅은 유지되지만, 전체 로드가 일어나는 시나리오는 도착 페이지에서 재주입한다. 재주입은 멱등이다(상태 초기화 없음 — 단, 전체 로드 후에는 어차피 새 상태다).

## 3. 요청 카운트 — 두 겹으로

- 1차: 계측 API — `window.__fePredeploy.resetRequests()` → 시나리오 → `countRequests('<엔드포인트 경로>', 'POST')`.
- 2차 교차 확인: `read_network_requests` (urlPattern 필터) — 계측 주입 전 발생분·서비스워커 경유 요청까지 보인다.
- 두 값이 다르면 원인(주입 시점, 리다이렉트, 프리페치)을 확인하고 근거 수치로는 보수적인 쪽(큰 값)을 기록한다.

## 4. 클릭·입력

- 연타는 `computer` 도구로 같은 좌표를 빠르게 반복 클릭한다(config `repeatClicks`회). 더블클릭 이벤트로 합쳐지는 것을 피하려면 클릭 간 약간의 간격을 둔다.
- 폼은 `form_input`을 우선 사용(IME·이벤트 시뮬레이션이 안정적). debounce 검증의 연속 타이핑은 `computer` 타이핑으로.

## 5. 뷰포트 스윕

`resize_window`로 config `viewports`를 순회하며 각 뷰포트에서:
1. 스크린샷 (근거 자료 — 파일명에 뷰포트 이름 포함)
2. 가로 오버플로 기계 판정: `document.documentElement.scrollWidth > window.innerWidth`

## 6. 주의사항

- **다이얼로그 금지**: alert/confirm/prompt가 뜨면 브라우저 세션이 멈춘다. `beforeunload` 핸들러가 있는 페이지의 이탈, confirm이 달린 삭제 버튼은 피하고, 불가피하면 사용자에게 먼저 알린다.
- **부수효과**: 운영 환경에서 결제·발송·삭제류 액션 금지 (SKILL.md 원칙 4).
- **실패 시**: 같은 조작이 2~3회 실패하면 반복하지 말고 상황을 기록하고 해당 항목을 skip(사유: 조작 불가)으로 넘긴 뒤 사용자에게 보고한다.
- **콘솔 필터**: `read_console_messages`는 pattern 파라미터로 필터한다 — 전체 덤프는 컨텍스트 낭비다(절대 규칙 7).
