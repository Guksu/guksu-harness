---
name: fe-predeploy
description: "요청된 프론트엔드 배포 점검을 계측하고 가능·불가·보류로 판정한다."
---

# FE-Predeploy — 프론트엔드 배포 전 점검

배포 전 확인을 "본 것 같다"가 아니라 **측정으로** 끝낸다. 모든 판정은 검증 수단 서열(규칙 기반 > 시각·실행 피드백 > LLM 판정)을 따르고, 브라우저 검증도 최대한 숫자로 환원한다 — "중복 클릭이 막히는 듯"이 아니라 "버튼 5연타 → POST 요청 1건".

## 절대 원칙

1. **요청 범위를 따른다.** 점검만 요청하면 판정까지 수행한다. 수정도 요청했다면 실패를 고치고 영향받은 항목을 재검사한다. 일반 재검사에 loop 스킬을 요구하지 않는다.
2. **프로덕션 빌드로 검증한다.** dev 서버는 React StrictMode 이중 실행·HMR 때문에 누수·렌더 계측이 왜곡된다. `build` + `preview`류(next는 `next build && next start`)를 기본으로 하고, dev 서버로 대신했다면 결과에 그 사실을 명시한다.
3. **프로젝트에 스크립트화된 검증(e2e·lighthouse CI)이 있으면 그것이 우선이다.** 규칙 기반 티어이므로 브라우저 수동 조작보다 서열이 높다. 없는 시나리오만 브라우저로 직접 검증한다.
4. **부수효과 안전.** 실 운영 URL에서 결제·실제 제출 같은 부수효과 있는 액션을 실행하지 않는다 — 로컬·스테이징 한정, 애매하면 사용자 확인. alert/confirm을 유발하는 요소는 브라우저 세션을 멈추므로 피한다(references/browser-recipes.md).
5. **판정은 3분류다: pass / fail / skip.** fail은 기준 미달(심각도 blocker면 "배포 불가" 판정), skip은 도구 부재·해당 없음 — **사유 필수**, 침묵 생략 금지. 브라우저 도구가 없으면 Phase 2~3을 skip 처리하고 "판정 보류 — 필수 런타임 검사 미실행"으로 명시한다.
6. 점검 요청만으로 커밋·푸시하지 않으며, 민감정보를 읽거나 기록하지 않는다. 발견한 시크릿 리터럴은 위치만 기록하고 값은 옮겨 적지 않는다.

## 기준치 — config가 단일 출처

프로젝트 `.agents/predeploy.config.json`(없으면 v2 위치 `.claude/predeploy.config.json`)이 있으면 그것을, 없으면 이 스킬 `assets/predeploy.config.json`의 기본값(Web Vitals 표준: LCP 2.5s·CLS 0.1·INP 200ms, 뷰포트 3종, 연타 5회·마운트 사이클 5회)을 쓴다. 기준치 조정 요청 시 프로젝트 사본을 만들어 수정한다 — 스킬 번들 원본은 고치지 않는다.

## 워크플로우

### Phase 0: 대상 확정

1. **요청과 기존 체크리스트에서 점검 플로우를 정한다** — 전 페이지 전수가 아니라 핵심 유저 저니 3~5개(예: 로그인, 결제, 폼 제출). 기존 체크리스트(`docs/predeploy/`)가 있으면 재점검/실패 항목만 재검인지 확인한다.
2. **환경·도구 가용성 점검** — 대상 URL(로컬 프로덕션 빌드 권장), claude-in-chrome 유무, `npx lighthouse` 실행 가능 여부, 기존 e2e 스위트 유무. 없는 도구에 걸린 항목은 skip으로 미리 분류한다.
3. **프레임워크 감지** — package.json으로 퓨어 JS / React / Next.js를 판별한다(정적 스캔과 레시피 선택에 사용).

### Phase 1: 정적 게이트 — 규칙 기반, 가장 싸고 확실한 것 먼저

| 검사 | 실행 | 판정 |
|------|------|------|
| 빌드·타입체크·린트 | 프로젝트 스크립트 (`build`·`tsc`·`lint`) | 종료 코드 0 (blocker) |
| 기존 테스트·e2e | `test`·e2e 스위트 | 전체 통과 (blocker) |
| 정적 스캔 | `node {이 스킬 경로}/scripts/staticScan.mjs <루트> --json` | blocker 0건(debugger·시크릿 리터럴), warn은 후보 목록으로 기록 |

정적 스캔은 휴리스틱이다 — warn(클린업 누락 후보, console.log, dangerouslySetInnerHTML, Next `<img>`·비공개 env, fetch `response.ok` 누락, IME `isComposing` 누락, unload 리스너, noopener 누락, 100vh, 무인자 로케일 포맷, font-display 누락)은 확정 버그가 아니라 Phase 2에서 우선 검증할 대상과 사용자 확인 목록의 입력이다.

### Phase 2: 런타임 계측 — 브라우저에서 숫자로

플로우마다: 페이지 진입 → `scripts/instrument.js` 주입 → 시나리오 실행 → `__fePredeploy.report()` 판독. 항목·레시피 상세는 references를 따른다:

| 카테고리 | 대표 항목 | 상세 |
|---------|----------|------|
| 인터랙션 안정성 | 버튼 연타 → API 1회, pending 상태, debounce, 언마운트 후 setState, 폼 검증, 뒤로가기 중복 제출, IME 중복 제출, 퍼널 히스토리, 무한스크롤 복원 | `references/interaction.md` |
| 메모리·리소스 | 마운트↔언마운트 반복 후 리스너·타이머 순증가 0, 구독·소켓 해제, fetch 취소 | `references/memory.md` |
| 네트워크 경계 | 4xx/5xx 에러 UI(무한 로딩 금지), 로딩 표시, 401 처리, stale 응답 무시 | `references/interaction.md` |
| 복원력·세션 | 배포 버전 스큐(ChunkLoadError), fetch ok 판정, Error Boundary 흰 화면, 서드파티 SPOF, 오프라인, bfcache, 토큰 리프레시 동시성, 멀티탭 로그아웃, 폴리필 갭, hydration mismatch | `references/resilience.md` |

### Phase 3: 성능·시각 스윕

| 카테고리 | 대표 항목 | 상세 |
|---------|----------|------|
| 성능 | Core Web Vitals(lighthouse), 번들 크기, 이미지·폰트 최적화, CLS 유발 요소, 과잉 리렌더 | `references/performance.md` |
| 품질 기본기 | 콘솔 에러 0건, 뷰포트 3종 레이아웃, 키보드·포커스, alt/aria, 색 대비·lang, reduced-motion | `references/quality.md` |
| 모바일·웹뷰 | iOS input 확대·100vh/safe-area·안드로이드 백버튼×모달·자동재생·터치 타깃 (실기기 필요 항목은 skip 분류) | `references/mobile-web.md` |
| 배포 설정·보안 | console.log·소스맵·메타 태그·CSP·XSS 싱크·noopener·업로드 검증·autocomplete·날짜/타임존 | `references/quality.md` |

시각 판단이 필요한 항목(레이아웃 깨짐, 디자인 이상)은 스크린샷을 근거로 남기되 pass/fail을 단정하지 말고 체크리스트의 "사용자 검토" 항목으로 분류한다.

### 종료: 기록과 판정

1. **체크리스트 기록** — `docs/predeploy/{YYYY-MM-DD}-{slug}.md` (템플릿: 프로젝트 `docs/templates/predeploy.md`, 없으면 `../history/assets/templates/predeploy.md`에서 복사). 전 항목의 판정·근거 수치·skip 사유를 남긴다. 재점검 시 새 파일이 아니라 기존 문서의 판정을 갱신하고 재실행 이력에 추가한다.
2. **종합 판정** — blocker fail이 있으면 "배포 불가". 없더라도 필수 검사에 도구 부재·환경 문제로 skip이 있으면 "판정 보류". 필수 검사가 통과했을 때만 "배포 가능"으로 쓴다. 적용 대상이 아닌 검사는 사유와 함께 `applicable: false`로 제외한다. warn은 사용자 검토로 올린다.
   - 검사 시작 전에 필수 항목을 정한다. 실행하지 못했다는 이유로 필수를 선택 항목으로 낮추지 않는다.
   - 체크리스트와 같은 범위의 JSON(`checks`: 이름·status·severity·required·skip 사유)을 기록하고 `node {이 스킬 경로}/scripts/decideRelease.mjs <결과.json>`으로 최종 판정을 확인한다. 종료 코드 0=가능, 1=불가, 2=보류/입력 오류다. 누락된 검사 자체는 JSON만으로 감지할 수 없으므로 계획한 모든 항목을 포함한다.
3. **보고** — 팀에서 작업 기록을 요구할 때만 그 문서에서 점검 결과를 참조하고, 채팅에는 요약(판정을 첫 문장으로 + fail/skip 수 + 경로)만. fail 항목은 계측 이름이 아니라 "사용자에게 어떤 일이 생기는가"로 풀어 쓴다(예: "버튼 연타 시 주문이 두 번 들어간다"). 수정 요청이 있으면 수정과 재검사를 이어간다.

## 브라우저 조작 공통 규칙

도구 로딩(ToolSearch 일괄), 계측 주입 절차, 요청 카운트, 뷰포트 전환, 다이얼로그 회피는 `references/browser-recipes.md`를 먼저 읽고 따른다.

## 하네스 연동

팀이 배포 게이트로 선택한 경우에만 프로젝트 절차에 연결한다. 기본 하네스 설치에는 포함되지 않는다. 독립적으로도 언제든 호출 가능하다.
