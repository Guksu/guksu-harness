# 메모리·리소스 정리 — 검증 레시피

누수는 "느껴질 때"는 이미 늦다 — 마운트↔언마운트를 반복시키고 **잔존 수의 순증가**를 잰다. 반드시 프로덕션 빌드에서 측정한다(StrictMode 이중 실행이 dev 계측을 왜곡한다).

## 공통 절차 — 반복 마운트 계측

1. 대상 페이지 진입 → `scripts/instrument.js` 주입.
2. 기준 스냅샷: `__fePredeploy.report()` 기록 (listeners·intervals·timeouts).
3. SPA 라우팅으로 대상 컴포넌트를 **마운트↔언마운트 config `mountCycles`(기본 5)회 반복** — 페이지 새로고침이 아니라 클라이언트 라우팅이어야 계측이 유지된다. 모달·탭이면 열고 닫기 반복.
4. 종료 스냅샷과 비교.

주입 후 첫 마운트 전 기준값을 잡는 이유: 앱 전역 리스너(라우터·스토어)는 잔존이 정상이다 — 보는 것은 절대값이 아니라 **사이클당 순증가**다.

## B1. 이벤트 리스너 잔존 (blocker)

- **왜**: `addEventListener`(특히 window·document 대상)를 해제하지 않으면 언마운트된 컴포넌트가 리스너와 클로저 체인으로 살아남는다 — 대표적 메모리 누수이자, 핸들러가 계속 실행되는 로직 버그.
- **방법**: 공통 절차 → `report().activeListeners`·`listenersByType` 비교.
- **판정**: N사이클 후 순증가 **0**. 사이클 수에 비례해 늘면 fail — `listenersByType`으로 어떤 이벤트인지 특정해 기록한다.

## B2. 타이머 잔존 (blocker)

- **왜**: `setInterval` 미해제는 누수이자 CPU 낭비·중복 폴링이다.
- **방법**: 공통 절차 → `report().activeIntervals` 비교. 장수 `setTimeout`(폴링 체인)은 `activeTimeouts` 추이로 본다.
- **판정**: 언마운트 후 해당 컴포넌트 몫의 interval 0. 사이클 비례 증가는 fail.

## B3. 구독·소켓 해제 (warn)

- **왜**: 스토어 subscribe·WebSocket·Observer를 해제하지 않으면 리스너와 같은 경로로 샌다.
- **방법**: 정적 스캔의 `effect-no-cleanup` 후보를 우선 확인 + WebSocket은 브라우저 개발자 도구/네트워크 탭에서 연결 수 확인.
- **판정**: 언마운트 후 구독·연결이 정리된다. 계측이 어려운 라이브러리 내부 구독은 코드 확인으로 대체하고 그 사실을 기록.

## B4. in-flight fetch 취소 (warn)

- **왜**: 언마운트 시 요청을 취소하지 않으면 A4(언마운트 후 setState)로 이어진다. AbortController가 표준 해법.
- **방법**: 느린 요청 중 이탈 → `read_network_requests`에서 취소(canceled) 여부 확인 + 콘솔 에러 0건.
- **판정**: 취소되거나, 최소한 응답 도착이 에러·경고를 만들지 않는다.

## B5. 메모리 추이 (참고 지표, warn)

- **방법**: 사이클 반복 전후 `performance.memory.usedJSHeapSize`(Chrome 전용) 비교. GC 타이밍에 좌우되므로 **단독 판정 금지** — B1·B2가 0인데 힙만 크게 증가하면 detached DOM 등 다른 누수 후보로 기록한다.
- **판정**: 참고 수치로만 기록. 이 값 하나로 fail을 주지 않는다.

## 정적 스캔과의 관계

`staticScan.mjs`의 `listener-no-cleanup`·`interval-no-clear`·`effect-no-cleanup`은 이 카테고리의 **후보 발견기**다 — 스캔 warn이 있는 컴포넌트를 반복 마운트 대상으로 우선 선정하면 적은 사이클로 실증할 수 있다. 스캔이 깨끗해도 런타임 계측은 생략하지 않는다(스캔은 휴리스틱이다).
