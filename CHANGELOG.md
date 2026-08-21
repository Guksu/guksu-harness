# Changelog

이 프로젝트는 [Semantic Versioning](https://semver.org/)을 따른다.

## [1.18.0] - 2026-08-21

mattpocock/skills 증류 릴리스 — [mattpocock/skills](https://github.com/mattpocock/skills)를 분석해(`docs/analysis/2026-08-21-mattpocock-skills.md`) 설계 문답을 중심으로 8개 스킬·참조 문서에 원리를 이식했다. v1.17.0 설계 문답의 직접 연장선.

### Added

- **설계 문답에 grilling 3요소 (`references/design-dialogue.md`)** — ① **프런티어 질문 선정**: 한 라운드에는 전제가 확정된 질문 전부를 묻고, 같은 라운드의 다른 열린 질문에 의존하는 질문은 다음 라운드로 미룬다(의존 질문을 섞으면 사용자가 안 정해진 답을 가정한 채 답하게 된다) ② **사실/결정 분리**: 결정은 사용자의 것, 사실은 에이전트의 것 — 라운드 중 필요한 사실은 묻지 않고 직접·서브 에이전트로 조사하며, 조사 중에도 나머지 프런티어는 비차단 진행 ③ **침묵된 가정 0**: 종료 조건이 3종→4종으로 — 최종 요약에서 각 결정이 사용자 답변에서 왔는지 검사하고, 전제한 가정은 질문으로 전환하거나 합의 후 설계서 §7에 기록
- **설계 문답 탈출구 2종 (`references/design-dialogue.md`)** — 무한 문답의 해소 경로: 실행해 봐야 아는 결정(상태 흐름·화면)은 1회용 **프로토타입**(명령 1개 실행·폴리시 생략·상태 표면화·결정만 남기고 폐기)으로, 제3자가 아는 결정은 전달용 **질문지**(`docs/design/questionnaire-{slug}.md` — 주제가 아니라 전달을 문답: 누구에게·무엇을 돌려받나)로 해소하고 나머지 프런티어는 계속 진행
- **스킬 작성 원칙 증보 (`references/skill-authoring.md`)** — 단계별 **완료 기준 2속성**(판별 가능성 — 모호한 기준은 조기 종료를 부른다 / 요구 수준 — 철저함은 부사가 아니라 기준으로 강제), **양성 진술**(금지문은 금지 대상을 활성화한다 — 목표 행동을 직접 진술, 하드 가드레일은 훅·deny 우선), **no-op 삭제**(기본 동작을 못 바꾸는 문장은 문장째 삭제, 판정은 실행으로), **트리거 단어 앞세우기**(포인터 전반의 워딩 = 도달성, 가지당 대표 표현 1개), **분기 기준 분리**(모든 경로가 읽는 것은 본문, 일부만 읽는 것은 references/)
- **버그 진단 규율 (`references/agent-design.md` §5)** — "피드백 루프가 90%다": 이 버그에만 빨간불이 켜지는 실행 명령 1개를 만들기 전에는 가설 금지 → 가설은 3~5개 랭킹·반증 가능한 예측 명시 → 계측은 가설당 변수 1개·`[DEBUG-태그]` 로그(grep 1회 청소) → 수정 전 최소화·수정 후 회귀 테스트(TDD 연동)
- **2축 분리 보고 (`references/agent-design.md` §5)** — 리뷰·QA 결과는 컨벤션 축과 스펙 축(승인된 설계서 기준)을 별도 보고하고 합산 순위를 매기지 않는다 — 한 축의 발견이 다른 축을 가리는 것을 방지
- **seam 사전 합의 (절대 규칙 2 확장)** — 테스트는 사전 합의된 공개 경계(seam — 호출자가 쓰는 인터페이스)에 쓴다. 어느 경계를 지킬지는 설계 문답 3라운드에서 합의하고 설계서에 기록 — SKILL.md·`assets/harness-rules.md` 정본·README 동기화
- **루프 체크포인트 2원칙 (`loop` 스킬)** — push right(사람 개입은 준비를 다 끝낸 뒤 한 번, 늦게) + 브리프(원본 출력이 아니라 결정 가능한 요약 + 산출물 경로 — 검토 속도가 루프의 처리량)
- **인계 규칙 2종 (`handoff` 스킬 + 템플릿)** — "다음 단계"에 이어서 쓸 스킬 이름 명시(이어받는 세션은 어떤 스킬이 쓰이고 있었는지 모른다) + 다른 산출물에 있는 내용은 옮겨 적지 않고 경로 참조(사본은 드리프트)
- **용어 벼리기 (`references/design-dialogue.md` §5 + 설계서 템플릿)** — 확정된 용어는 설계서 §3에 그 자리에서 기록, 애매한 용어는 정밀한 후보로 고정, 기록된 정의와 어긋난 사용은 즉시 되물음
- **분석 문서 (`docs/analysis/2026-08-21-mattpocock-skills.md`, 신규)** — 저장소 개요, grilling↔설계 문답 축별 비교, 차용 후보 A/B/C 등급과 도입 불필요 근거(git-guardrails는 우리 훅이 상위 호환 등)

### Changed

- README — 용어 사전에 프런티어·공개 경계(seam) 추가, 설계 문답 소개에 프런티어·사실 조사·탈출구 2종·가정 검사 반영, 절대 규칙 2 행에 seam 합의 반영, 버전 표기 v1.18.0

## [1.17.0] - 2026-08-19

설계 문답 릴리스 — "구축보다 설계 합의가 먼저다"(핵심 원칙 7 신설). 신규 구축은 파일을 만들기 전에 사용자와의 반복 문답으로 시스템 설계를 확정하고, 모든 출력에 쉬운 말 규칙(절대 규칙 8)을 적용한다.

### Added

- **설계 문답 (`references/design-dialogue.md`, 신규)** — Phase 1에 구축 전 문답 단계 신설. 한 번 묻고 끝내지 않는다: 매 라운드 ① 이전 답변 전체를 설계 초안으로 종합해 보여주고(라운드 간 모순 점검) → ② `AskUserQuestion`으로 질문 2~4개(한 라운드 = 한 주제) → ③ 설계 문서에 반영, 을 반복한다. 보통 30분~1시간·신규 구축 최소 3라운드 상정, 종료 조건 3종(새 미해결 질문 없음 · 모순 0 · 최종 요약 사용자 승인). 주제 사다리(목표·범위 → 도메인·데이터 → 실행 방식·안전장치 → 종합 확인), 무한 문답 방지(같은 결정의 질문 변형이 3라운드 반복되면 추천안 제시 후 결정 요청), 질문 작성 규칙(질문 하나 = 결정 하나, 전문용어 한 줄 풀이, 선택지마다 결과 표기, 추천안 명시, 이전 답변 인용) 포함. 기존 확장은 축소판(1~2라운드), 운영·해체는 생략, 사용자가 생략을 명시하면 최종 요약 승인만 남긴다
- **설계서 템플릿 (`skills/docs/assets/templates/design.md`, 신규)** — 목표·완료 기준 / 범위(포함·제외 명시) / 시스템 구조 / 실행 방식·역할 / 안전장치·권한 / 문답 기록(라운드별 결정 — 번복도 지우지 않고 기록) / 미해결 질문 7섹션. 라운드마다 갱신해 문답이 중단돼도 문서만으로 재개 가능. 승인된 설계서(`docs/design/`)가 절대 규칙 4의 단일 출처가 되고, Phase 2 중 설계와 다른 결정은 사용자 확인 후 설계서를 먼저 갱신한다
- **절대 규칙 8 (신규)** — 출력은 읽는 사람이 이해할 수 있게: 전문용어는 첫 등장 시 한 줄 풀이, 한 문장에는 하나의 내용, 약어·영문 용어 풀이 없는 나열 금지. 질문·보고·문서 등 사용자에게 보이는 모든 출력에 적용. `harness-rules.md` 정본에 추가되어 모든 하네스에 배포된다
- **핵심 원칙 7 (신규)** — "구축보다 설계 합의가 먼저다": 승인 없는 설계는 추측이고, 추측 위에 지은 스캐폴딩은 재작업 후보다

### Changed

- **Phase 1 재편** — "설계" → "설계 문답 → 설계". 도메인 분석은 문답의 질문거리를 준비하는 조사로 재정의(파악한 것은 묻지 않고 확인만), 실행 모드·티어 판정은 문답에서 확인된 내용을 근거로 수행. 산출물 체크리스트에 설계서 항목 추가(승인된 설계서 존재 + Phase 2 산출물과의 일치)
- docs 스킬 — 템플릿 번들 8종으로(공통 6종 + 설계 1종 + 도메인 1종), 설계서 템플릿은 Phase 1 설계 문답 시작 시 복사
- README — §4-3 단계 표·문답 안내, §5 harness·docs 설명, §7 절대 규칙 8종, §9·§12 구조 트리 반영

## [1.16.0] - 2026-08-05

### Added

- **`fe-craft` 스킬 (신규, 11번째)** — 프론트엔드 제작 품질: "동작하는" 화면과 "완성도 있는" 화면 사이를 메운다. fe-predeploy(배포 직전 1회 게이트·판정)와 달리 제작·수정 중 반복 루프(개선)를 담당. 외부 공개 자료 3종을 라이선스 검토 후 접목:
  - `references/design-principles.md` — 디자인 8원칙(대비·위계·정렬·근접·반복·균형·여백·통일) 스크린샷 비평 프레임워크. 원칙별 정의·AI 산출물의 흔한 위반·비평 질문 + 비평 루프 운영 규칙(렌더→원칙 이름으로 비평→상위 2~3개만 수정→재렌더 비교→수렴, 무난함≠완성). 고전 디자인 이론의 자체 서술이며 Expo 블로그 글(©650 Industries, 라이선스 없음 — 본문 비복제)은 아이디어 영감으로만 명시
  - `references/animation.md` — 모션 리뷰 기준: 결정 프레임워크 4질문(필요성·빈도별 모션 예산·이징 선택·요소별 지속시간 예산), 비타협 기준 10(UI ease-in 금지·300ms 이하·scale(0) 금지·transform-origin·중단 가능성·GPU 속성·reduced-motion·비대칭 타이밍 등), 즉시 플래그 트리거 14종, 개선 서열 9단계(삭제가 1순위), Block/Approve 판정. Emil Kowalski skills 저장소(MIT) 증류
  - `references/react-performance.md` — React/Next.js 성능 규칙 70종 우선순위 인덱스(워터폴·번들 CRITICAL부터 8카테고리), 상세는 업스트림 rules/ 참조 방식. Vercel react-best-practices(SKILL.md frontmatter MIT 선언) 증류
  - `LICENSES.md` — 원천별 라이선스 고지(Emil MIT 전문·Vercel frontmatter 선언 근거·Expo 비복제 확인). 스냅샷 날짜 명시, 충돌 시 업스트림 우선
- harness 스킬 Phase 2-6: 프론트엔드 도메인 하네스에 fe-craft 연결(제작 품질) 명시 — fe-predeploy(배포 게이트)와 역할 분담

## [1.15.0] - 2026-08-05

하네스 다이어트 릴리스 — "페르소나보다 작업별 스킬, 산문 지침보다 기계적 강제"로 재정렬. 현행 모델은 정체성 부여·세부 작업 지시 없이 작업 명세(입출력 계약)만으로 잘 수행한다는 전제를 반영해, 스캐폴딩·복제·의례를 규모에 비례하게 줄였다.

### Added

- **티어 신설 (라이트/풀)** — 실행 모드 사다리 판정이 Phase 2 산출물 규모를 결정한다. 직접 실행·서브 1개면 **라이트 티어**: 도메인 스킬 + 훅·권한 + 규칙 파일 + 템플릿 2종(worklog·handoff)만 생성하고 에이전트 정의·오케스트레이터는 만들지 않는다. 루프·Workflow·팀이면 풀 티어. 산출물 체크리스트도 공통/풀 티어로 분리
- **`assets/harness-rules.md` (신규)** — 절대 규칙 7종의 정본. Phase 2에서 프로젝트 `docs/harness-rules.md`로 복사되고, 오케스트레이터·에이전트 정의는 규칙 전문 복제 대신 포인터 한 줄만 갖는다(복제본 드리프트 방지 — 기존에 SKILL.md·에이전트 템플릿·오케스트레이터 템플릿 3곳의 문구가 이미 어긋나 있었다)
- **핵심 원칙 6 (신규)** — "산문보다 기계적 강제, 페르소나보다 계약": 규칙은 훅·deny·게이트로 강제하고, 늘릴 것은 계약과 게이트지 지시문이 아니다
- **validateHarness description 길이 검사** — description 350자 초과 시 warn(상시 로딩 비용). 회귀 테스트 2종 추가(19→21)

### Changed

- **에이전트 정의 파일화 조건부화** (agent-design.md §3) — "모든 에이전트는 정의 파일 필수(빌트인이라도)"를 폐기. 파일화는 팀 모드 팀원·세션 간 재사용·Workflow `agentType` 연결 시에만, 단발 위임은 작업 프롬프트 + 스킬 포인터로 수행. 템플릿에서 "당신은 ~입니다" 페르소나 서술 제거, 계약(책임 범위·입출력·에러 핸들링) 중심으로 재편. 정의가 자동 로드되는 호출에서 정의 전문의 프롬프트 중복 포함 금지
- **종료 의례 규모 비례화** — 매 실행 필수는 워크로그뿐. HTML 보고서(report)는 대형 실행(멀티에이전트·스프린트 단위)·명시 요청 시로, 회고 제안(retro)은 반복 문제 감지(같은 피드백 2회·반복 실패) 시로 한정. 공통 템플릿 복사도 티어에 맞게(라이트 2종/풀 6종)
- **스킬 description 10종 압축** — "(1)~(4) 반드시 사용" 번호 열거 스캐폴딩 제거, 트리거 표현만 유지(최대 ~490자 → 전부 300자 이내). skill-authoring.md에 길이 규율(~350자, "pushy와 장황은 다르다") 명문화
- README — 티어·규칙 단일 출처·조건부 종료 의례 반영(작업 사이클 다이어그램·§7·§8-2·§9 구조 트리)

fe-predeploy 체크리스트 확장 릴리스. 국내 기업 기술블로그(우아한형제들·토스·오늘의집·비브로스 — 실제 장애 사례)와 해외 공식 소스(web.dev·react.dev·Next.js·OWASP·MDN)를 병렬 리서치해 검증된 항목만 반영했다(출처 병기). 체크리스트 28 → 59항목(신규 31).

### Added

- **`references/resilience.md` (신규)** — 복원력·세션 카테고리 11항목: 배포 버전 스큐(ChunkLoadError — 우아한형제들 Sentry 운영 사례), fetch `response.ok` 판정(4xx에서도 resolve), Error Boundary 부재 흰 화면 + 커스텀 404, 서드파티 스크립트 SPOF(도메인 차단 후 생존 확인), 오프라인·저속 네트워크, bfcache 복원 상태·차단 요인, **토큰 리프레시 동시성**(중복 리프레시 → 전체 로그아웃), 멀티탭 로그아웃 전파, **브라우저 타깃·폴리필 갭**(배민 장바구니 백지 화면 사례), 에러 모니터링 노이즈(rate limit로 장애 로그 유실), hydration mismatch(Next SSR)
- **`references/mobile-web.md` (신규)** — 모바일·웹뷰 카테고리 7항목: iOS input 16px 미만 자동 확대, 100vh·safe-area(dvh), **안드로이드 물리 백버튼 × 모달·바텀시트**(작성 중 입력 소실), iOS 미디어 자동재생 정책, Safari blur·border-radius 함정, 터치 타깃 48px(config `touchTargetPx`), 웹뷰 디버깅 가능성. 에뮬레이션 판정 불가 항목은 skip(사유: 실기기 필요) 분류 원칙 명시
- **기존 카테고리 확장** — interaction: **한글 IME 조합 중 Enter 중복 제출**(isComposing), 다단계 퍼널 히스토리 정합(토스페이먼츠 사례), 무한스크롤 뒤로가기 복원·offset 페이지네이션(오늘의집 사례) / performance: 웹폰트 font-display(Safari 무기한 FOIT)·CLS 유발 요소(동적 배너·top/left 애니메이션)·가상 리스트 높이 오차 시나리오 / quality: 접근성 확장(색 대비·lang·스킵 링크·라이브 리전, prefers-reduced-motion), 보안·데이터(CSP·DOM XSS 싱크·tabnabbing noopener·파일 업로드·폼 autocomplete·**날짜/로케일/타임존**)
- **staticScan 규칙 10 → 17종** (TDD, 테스트 10 → 17종) — `fetch-no-ok-check`·`ime-enter-no-composing`·`unload-listener`·`blank-no-noopener`(window.open 포함)·`vh-100`·`date-locale-implicit`·`font-display-missing`. **CSS 파일(.css/.scss/.sass/.less) 스캔 지원** — CSS에는 CSS 규칙만 적용(JS 규칙 오탐 방지)

### Changed

- SKILL.md Phase 2·3 카테고리 표에 복원력·모바일 행 추가, 정적 게이트 규칙 열거 갱신. config에 `touchTargetPx: 48`. 회귀 테스트 66→73종

## [1.13.0] - 2026-07-31

### Added

- **`fe-predeploy` 스킬 (신규)** — 프론트엔드(퓨어 JS·React·Next.js) 배포 전 점검을 담당하는 열 번째 스킬. "본 것 같다"가 아니라 측정으로 판정한다: 정적 게이트(빌드·린트·테스트·정적 스캔) → **실제 브라우저 런타임 계측**(버튼 5연타 → API 1회, 마운트 N사이클 → 리스너·타이머 순증가 0, 언마운트 후 setState, 4xx/5xx 무한 로딩 금지, stale 응답) → 성능(Core Web Vitals — lighthouse, 번들·이미지·가상화) → 시각·UX 스윕(뷰포트 3종·접근성·콘솔 에러 0건·소스맵/시크릿 노출). 판정은 pass/fail/skip 3분류(skip 사유 필수), blocker fail이면 "배포 불가". 점검과 수정 분리(수정은 제안까지 — "통과까지"는 loop 스킬 결합), 프로덕션 빌드 검증 원칙, 스크립트화된 e2e 우선(검증 수단 서열), 운영 환경 부수효과 금지. 결과는 `docs/predeploy/{YYYY-MM-DD}-{slug}.md` 갱신형 체크리스트로 누적
- **런타임 계측 스니펫** (`skills/fe-predeploy/scripts/instrument.js`) — claude-in-chrome `javascript_tool`로 주입하는 플레인 스크립트. addEventListener/removeEventListener(once 제외)·setInterval/clearInterval·setTimeout(발화 시 자동 제외)·fetch·XHR(axios 브라우저 어댑터)·console.error를 패치해 `__fePredeploy.report()`/`countRequests()`로 잔존·요청 수를 숫자로 판독. 멱등 주입, Node에서도 동작해 단위 테스트 5종 포함
- **정적 스캔** (`skills/fe-predeploy/scripts/staticScan.mjs`) — 휴리스틱 후보 발견기: 리스너/타이머/useEffect 클린업 누락, console.log(warn)·debugger(blocker), 시크릿 리터럴 패턴(blocker — 값은 기록하지 않음), dangerouslySetInnerHTML, Next 전용(`<img>` 태그, 'use client'의 비공개 process.env). node_modules·빌드 산출물·테스트 파일 제외, `--json` 출력, blocker 시 exit 1. CLI 진입 판정은 훅과 동일한 realpath 정규화. 회귀 테스트 10종
- **기준치 config** (`assets/predeploy.config.json`) — Web Vitals 표준 기본값(LCP 2.5s·CLS 0.1·INP 200ms·lighthouse 80/90), 뷰포트 3종, 연타·마운트 사이클 횟수. 프로젝트 `.claude/predeploy.config.json` 사본이 단일 출처
- **배포 전 점검 템플릿** (`skills/docs/assets/templates/predeploy.md`) — 공통 6종 + 도메인 1종 체제. 점검 범위/정적 게이트/런타임·성능·품질(심각도·근거 수치)/사용자 검토 필요/재실행 이력 5섹션. 재점검은 새 파일이 아니라 판정 갱신
- **references 5종** — interaction(연타·debounce·폼·stale)·memory(반복 마운트 계측 절차)·performance(lighthouse·번들)·quality(반응형·접근성·소스맵)·browser-recipes(도구 일괄 로딩·주입·요청 2중 카운트·다이얼로그 회피)

### Changed

- **하네스 내장** — 프론트엔드(웹 UI) 도메인 하네스 구축 시 predeploy 템플릿을 함께 배포하고 오케스트레이터 종료 절차에 fe-predeploy 배포 게이트를 명시 (harness SKILL.md Phase 2·orchestrator-template 골격·docs 스킬 템플릿 표). 회귀 테스트 51→66종

## [1.12.1] - 2026-07-31

Claude 5(Fable 5·Opus 5) 세대 플랫폼 현행화 점검에서 확인된 수정. 핵심 정책(모델 세션 상속·단일 우선 사다리·파일 기반 산출물)은 변경 없음 — 세대 교체를 무사 통과했다.

### Fixed

- **훅 4종 공통 fail-open 봉합** (`blockGitMutation`·`branchGuard`·`blockSecretAccess`·`verifierGate`) — CLI 직접실행 판정(`process.argv[1] === fileURLToPath(import.meta.url)`)이 심링크가 낀 호출 경로에서 어긋나(ESM URL은 realpath, argv[1]은 원문) 훅이 아무것도 안 하고 exit 0으로 통과하던 결함. macOS `/tmp`·`/var` 하위나 심링크된 프로젝트 경로에서 git 차단·시크릿 차단·브랜치 가드·검증자 게이트 전체가 조용히 무력화됐다. 양쪽을 `realpathSync`로 정규화해 비교하도록 수정, 심링크 경유 호출 회귀 테스트 추가(50→51종)
- **"유일한 예외" 잔존 표기 정정** — v1.12.0에서 절대 규칙 1이 예외 2종 체제가 됐는데 branch 스킬·README에 "유일한 예외"가 남아 있던 표기를 "예외 ①"로 동기화
- **loop 실행 수단에서 구 `/goal` 제거** — 현행 환경에 없는 명령이라 매핑이 실행 불가였다. 조건 충족까지 반복은 검증자 게이트(Stop 훅)가 담당하고, `/loop`은 간격 지정·자율 페이스(간격 생략) 양쪽을 흡수, cron 예약 실행(`schedule` 류)을 선택지로 추가. "빌트인 명령은 세션·버전마다 다르므로 매핑 전에 존재를 확인한다" 원칙 명문화 (loop SKILL.md·execution-modes §6·harness SKILL.md·README·loop-spec 템플릿)

### Changed

- **서브 에이전트 백그라운드 기본값 반영** — Agent 도구는 이제 기본이 백그라운드 실행(완료는 통지로 도착, 동기 실행은 `run_in_background: false`). 통지 전 결과 추측 금지 명시 (execution-modes §5·orchestrator-template §3)
- **컨텍스트 요약·이월 현행화** — "~80% 자동 컴팩션" 서술을 "긴 대화는 자동 요약되어 다음 컨텍스트 창으로 이월"로 교체. 한계 임박은 더 이상 인계 사유가 아니며 handoff의 초점은 **세션 경계**(다음 세션·다른 담당자)임을 명시 — 유실되면 안 되는 결정·시도 기록의 파일 이관 가치는 유지 (context-economy §1·handoff SKILL.md·orchestrator-template §5)
- **Workflow 신규 제약 반영** — 세션 기본 규모 가이드라인(에이전트 ~15개 등)·수명당 1000 에이전트 캡·호출당 항목 4096 상한, 스킬·슬래시 명령 지시의 옵트인 인정과 ultracode 상시 옵트인 세션 (execution-modes §3)
- **플랫폼 영구 메모리와의 경계 명시** — 레포가 기록하는 것(워크로그·다이제스트·CLAUDE.md)은 메모리에 중복 저장하지 않는다: 레포 파일은 팀 공유·감사 추적, 메모리는 세션 사용자 전용 (context-economy §1)
- **report 전달 수단에 Artifact 병용 언급** — HTML 게시 도구가 있으면 열람 수단으로 쓸 수 있되 정본은 `docs/reports/` 파일, 게시는 사용자 의사 확인 후 (report SKILL.md)

## [1.12.0] - 2026-07-21

### Added

- **`pr` 스킬 (신규)** — 사용자가 **명시적으로 요청한 경우에만** 에이전트가 커밋 메시지를 작성해 commit·push하고 PR을 생성하는 아홉 번째 스킬. 절대 규칙 1("git 작업은 사용자 전담")의 두 번째 예외(① 브랜치 전환에 이어)로, 요청 없는 선제 커밋은 계속 금지다. git-flow(main ← dev ← feat) 기준: 작업은 `feat/{slug}`에서, PR 베이스는 `dev`, `dev → main`(릴리스)·머지는 사용자 전담. 커밋은 Conventional Commits + `-m` 인라인 메시지만, 스테이징은 `git add .`가 아니라 경로 명시
- **커밋 메시지 Claude 작성 표기 절대 금지 — 기계적 강제** — `Co-Authored-By: Claude`·`🤖 Generated with [Claude Code]`·`Claude-Session:`·`noreply@anthropic.com` 패턴이 든 커밋을 훅이 명령 전체(heredoc 메시지 본문 포함)에서 검사해 차단한다. PR 제목·본문도 동일 규칙(지침 강제). 단순 "claude" 단어는 오탐하지 않는다
- **`blockGitMutation` 훅에 commit·push 옵트인 예외** — 스크립트 옆 `blockGitMutation.config.json`의 `{ "allowCommitPush": true }`일 때만 commit·push가 열린다(구축 시 사용자 확인 후 구성, config 없음/파싱 실패는 fail-closed로 기본 차단 유지). 열린 상태에서도 계속 차단: Claude 표기 커밋, 메시지 검사 불가 형태(`-F`/`-t`/`-c`/`-C`·`--amend`/`--fixup`/`--squash`), force/delete/mirror/prune push, commit·push 외 모든 변경 명령(merge·rebase·reset·checkout 등). 판정은 `judgeGitCommand(command, {allowCommitPush})`로 사유별(rule) 안내 메시지 제공
- **회귀 테스트 4종 추가(46→50)** — 예외 모드 허용/차단 경계(heredoc 커밋·복합 명령 포함), Claude 표기 차단·오탐 방지, 검사 불가 커밋 플래그·force/delete push(따옴표·번들 형태), CLI 경로(config 옵트인·표기 차단·파싱 실패 fail-closed)

### Changed

- **절대 규칙 1을 예외 2종 체제로 개정** — "유일한 예외(브랜치 전환)"에서 "예외 ① 브랜치 전환(branch 스킬) + 예외 ② 사용자 명시 요청 커밋·PR 업로드(pr 스킬)"로. SKILL.md·README·orchestrator-template 골격·agent-design 에이전트 정의 템플릿의 규칙 열거 동기화
- **git-flow(main·dev·feat) 반영** — branch 스킬의 이름 제안에 "git-flow 프로젝트면 `feat/{slug}`를 dev에서 분기(`git switch -c feat/<slug> dev`)" 추가, git-flow 채택 시 branchGuard `protectedBranches`에 `dev` 포함(작업은 항상 feat/*에서). harness Phase 2 훅 구성·산출물 체크리스트에 PR 플로우 옵트인 절차 추가 (hooks-and-permissions §2)

## [1.11.0] - 2026-07-08

### Added

- **`report` 스킬 (신규)** — 작업 종료 보고를 채팅 장문 텍스트 대신 **HTML 보고서**(`docs/reports/{YYYY-MM-DD}-{slug}.html`)로 생성해 히스토리로 누적하는 여덟 번째 스킬. 5개 고정 섹션(요약 / 작업 내용 / 검증 결과 / **사용자 검토 필요** — 선택지·영향·기본 동작 병기 / **후속 조치** — 트리거·담당 명시), 채팅 보고는 3~5문장 요약+경로+검토 항목 수로 축소, slug를 워크로그와 일치시켜 정본(md)↔뷰(html) 쌍 추적, 삭제 없이 누적(감사 추적). 인덱스 파일은 만들지 않는다 — 날짜 접두사 파일명과 파일 시스템이 단일 출처
- **HTML 보고서 템플릿** (`skills/docs/assets/templates/report.html`) — docs 스킬 템플릿 6종 체제. **중립 테마 고정**(백지·슬레이트·상태색: 완료=녹색/검토=호박색/후속=청색), 자립형(외부 리소스 없음)·인쇄 대응, 상태 배지(done/partial/stopped)
- **하네스 내장** — Phase 2 템플릿 배포 6종 확장, 오케스트레이터 종료 절차를 "HTML 보고서 생성 → 채팅에는 요약·경로·검토 항목 수만"으로 갱신 (orchestrator-template 골격·실전 예시)

### Changed

- **validateHarness 공통 템플릿 목록 확장** — report.html 추가, 템플릿 검사 테스트 2건에 단언 확장(총 46종 유지). testing-guide 검사 목록 동기화

## [1.10.2] - 2026-07-08

전체 하네스 정책 정합성 감사(정책 일관성 + 동작↔문서 대조, 병렬 감사 2종)에서 확인된 11건 수정. 동작 버그 0건 — 규칙↔강제 공백과 문서 누락 계열.

### Fixed

- **git restore·clean 차단 추가** (`blockGitMutation.mjs`) — checkout을 "파일 복원 기능 때문에 전체 차단"하면서 같은 워킹트리 파괴 계열인 restore·clean은 통과하던 규칙↔강제 공백 봉합. 차단 테스트 2종 추가
- **오케스트레이터 골격 절대 규칙 7종 완성** (`orchestrator-template.md`) — 골격이 5종만 담아 "절대 규칙 7종 반영" 체크리스트를 통과할 수 없던 누락(규칙 3 파일 기반·규칙 5 QA 교차검증) 보충. 에이전트 정의 템플릿의 규칙 열거도 7종으로 완성 (agent-design)
- **validateHarness에 blockSecretAccess 미등록 경고 추가** — 문서가 요구하는 훅 3종 중 1종의 누락이 감사에서 침묵 통과되던 공백. 테스트·testing-guide 목록 갱신
- **루프를 실행 모드 열거에 반영** — harness SKILL.md description(상시 로딩 표면)과 오케스트레이터 골격의 실행 모드 필드에 루프 누락 수정, §3에 루프 골격(명세·게이트 포인터) 추가
- **retro↔harness 트리거 경계 명문화** — '하네스 보완/업데이트' 류 발화가 두 스킬에 모두 매칭되던 모호성: retro description에 "구조 점검·동기화·직접 수정은 harness 스킬 대상" 구분 문장 추가
- **loop-spec 템플릿에 stuckAfter 미러링 안내** — 막힘 판정 값을 명세에만 적으면 기계적으로 강제되지 않는다는 안내가 템플릿 단계에 없던 공백
- **문서 표기 동기화** — README 차단 플래그에 `-d` 추가·`restore`/`clean` 반영, branchGuard 매처 표기를 Edit/Write/NotebookEdit로 통일 (README·hooks-and-permissions §3)

## [1.10.1] - 2026-07-08

v1.7.0~v1.10.0 전 범위 코드 리뷰(파인더 7앵글 + 실행 검증)에서 확인된 10건 수정.

### Fixed

- **git switch 파괴 플래그 우회 봉합** (`blockGitMutation.mjs`) — 정규식 한 줄 판정이 git의 번들(`-fc`)·값 붙임(`-Cmain`)·셸 따옴표(`"-f"`) 형태를 전부 통과시키던 결함을 토큰 단위 검사로 교체. `--orphan`(워킹트리 비움)·`-d`/`--detach`(detached HEAD로 branchGuard 무력화) 차단 추가, 꼬리 캡처가 개행을 포함해 멀티라인 명령의 다음 줄 플래그를 오인하던 오탐 수정, `/g` 전역 매칭으로 한 명령 안의 두 번째 switch도 검사
- **verifierGate 막힘 시그니처를 출력 전체 기준으로 교체** — 첫 줄 기반 시그니처는 npm 배너("> pkg@1.0.0 test")가 첫 줄이면 모든 실패가 동일해져 수렴 중인 루프를 막힘으로 오판·조기 종료시켰다. 전체 출력(숫자·공백 정규화, 500자 캡)으로 실패 목록의 변화(진전)를 감지
- **verifierGate allow 경로가 iterations를 리셋하던 회귀 수정** — flaky 체크가 한 번 통과할 때마다 maxIterations가 무력화되어 세션당 총 차단 횟수를 상한하지 못했다. 통과 시 막힘 추적(signature/streak)만 초기화하고 iterations(문서화된 세션 누적 의미)는 보존. 상태 쓰기는 쓰기 직전 재읽기 + 자기 키만 갱신으로 동시 세션 카운터 클로버 창을 축소, 변경 없으면 쓰지 않음
- **checkFreshness check가 --root 생략 시 크래시** — usage에 선택으로 표기된 `--root` 없이 실행하면 indexOf(-1)+1=0 산술로 다이제스트 경로 자체가 제외되어 undefined 크래시. splice 기반 파싱으로 교체, `--root` 값 누락도 명확한 에러로
- **branchGuard 설정 파싱 실패 시 fail-closed** — 깨진 branchGuard.config.json에서 uncaught 예외로 죽으면(exit≠2는 비차단) 보호가 조용히 사라졌다. 파싱 실패 시 차단 + 안내 메시지
- **SKILL.md 구 실행 모드 모델 잔존 수정** — v1.10.0의 에스컬레이션 사다리가 references에만 반영되고 항상 로드되는 SKILL.md(핵심 원칙 2·Phase 1 표)는 수평 모델 그대로라 릴리스 취지가 무효였다. 원칙 2를 "단일 우선 사다리"로 교체, Phase 1 표를 사다리 순(직접 실행 단 신설, 팀=최후)으로 재배열
- **문서 정합** — testing-guide 검사 목록에 branchGuard·공통 템플릿 검사 추가(누락), execution-modes의 핸드오프 포인터를 §9(무관한 표)에서 orchestrator-template §4로 정정, context-economy 목차에 §3.1 추가, CHANGELOG 1.10.0의 테스트 수 표기(3종→2종) 정정, 차단 플래그 목록을 훅 실구현과 동기화(README·branch 스킬·hooks-and-permissions)

### Added

- **회귀 테스트 3종 추가(43→46)** — switch 우회 형태 12케이스(번들·붙임·따옴표·orphan·detach·멀티라인·복합 명령), branchGuard CLI 스폰 테스트(차단/통과/fail-closed), checkFreshness CLI --root 생략·값 누락 테스트. failureSignature 테스트를 전체 출력 기준으로 재작성

## [1.10.0] - 2026-07-08

업계 실무 방법론 조사(Anthropic·OpenAI·Google 공식 가이드 + Airbnb·Shopify 프로덕션 사례, 3인 적대 검증 통과 22건)를 반영한 방법론 정합화 릴리스. 신규 파일 없이 기존 references·훅·스킬을 보강한다.

### Added

- **실행 모드에 "단일 우선" 에스컬레이션 사다리** (`execution-modes.md` §1) — 멀티에이전트를 기본값으로 고르지 않는다. 근거: 멀티에이전트는 채팅 대비 ~15배 토큰이며 성능 이득의 80%가 토큰 사용량 자체로 설명됨(Anthropic), 대부분의 코딩 작업은 부적합, "단일 능력 소진 후에만 멀티에이전트"(OpenAI). 사다리(직접 실행→서브1→루프→Workflow→팀)와 기계적 상향 트리거 2종(로직 과다·도구 유사도 과부하), manager/decentralized 패턴 선택 규칙 추가. 결정 트리에 단일 우선 게이트 삽입
- **대량 마이그레이션 실행 모드** (`execution-modes.md` §7) — 기계적 대량 변환 패턴(Workflow pipeline + 파일 단위 상태머신 + per-item 재시도 예산). 근거: Airbnb Enzyme→RTL 3,500파일 18개월→6주(>10배), 무식한 재시도 루프가 정교한 프롬프트를 이김(단순 ~10회·롱테일 50~100회)
- **컨텍스트 경제 예외 조항** (`context-economy.md` §3.1) — 대량 기계적 변환은 "최소 고신호 토큰"의 예외. Airbnb는 프롬프트를 4만~10만 토큰까지 불려 성공(관련 파일 50개·few-shot). 추론 작업과 기계 변환 작업의 판별 기준 명시
- **도구 위험 3등급 가드레일** (`hooks-and-permissions.md`) — allow/block 이분법 대신 low(allowlist)/medium(기본)/high(deny·훅·확인) 분류(OpenAI). 기존 훅 3종(git·시크릿·브랜치)을 high 등급 사례로 재배치, 새 도메인은 high 도구(결제·배포·프로덕션 DB) 재분류. SKILL.md Phase 2·allowlist 선정 기준 연동
- **검증 수단 신뢰도 서열** (`agent-design.md` QA 가이드 + `loop` 스킬) — 규칙 기반(종료 코드) > 시각·실행 피드백 > LLM 판정 순. LLM 판정은 "robust하지 않음"(Anthropic)이라 단독 종료 판정 금지 — loop 자기평가 금지와 동일 원리로 명문화
- **검증자 게이트 막힘 판정** (`verifierGate.mjs` `stuckAfter`) — 같은 실패 시그니처(검증 이름+출력 첫 줄, 숫자 정규화)가 N연속이면 예산 소진 전에 막힘으로 보고 후 종료. 루프 명세의 "막힘 판정"을 config로 강제하는 수단(Google ADK의 하드 예산+품질 조기탈출 dual-exit). 세션 상태 스키마를 {iterations,signature,streak}로 확장(구 숫자 스키마 호환). 회귀 테스트 2종 추가(41→43)

### Changed

- **병렬성 분리 축을 breadth-first로 정밀화** (`agent-design.md`) — 멀티에이전트의 본질은 협업이 아니라 토큰 예산(컨텍스트 창 용량) 병렬 확장(Anthropic, 이득의 80%가 토큰). 순차 의존 작업을 여러 에이전트로 짜면 토큰만 15배 쓰는 안티패턴임을 명시
- **핸드오프를 명시적 계약으로 규정** (`orchestrator-template.md` §4) — 에이전트 간 인계는 자유 서술이 아니라 약속된 상태 키(경로+형식)로. Google ADK output_key→state 원리, 흐릿한 계약이 경계면 버그의 근원

## [1.9.0] - 2026-07-07

### Added

- **`branch` 스킬 (신규)** — 파일 변경 작업 시작 전에 현재 브랜치를 점검하고, 보호 브랜치(main·master 등) 위라면 어떤 브랜치로 이동/생성할지 **사용자 확인 후** 전환하는 스킬. 이름 제안(기존 브랜치 패턴 우선 → `{type}/{slug}`), 전환 거부(미커밋 충돌) 시 처분은 사용자 몫, 보호 브랜치에서 계속하려면 사용자가 직접 config 수정(에이전트 우회 금지)
- **브랜치 가드 훅** (`assets/hooks/branchGuard.mjs`) — matcher `Edit|Write|NotebookEdit` PreToolUse 훅. 보호 브랜치 위 파일 편집을 차단하고 branch 스킬 사용을 지시한다. `.git/HEAD` 직접 판독(서브프로세스 없음, worktree `gitdir:` 포인터 추적, detached HEAD·비저장소는 비활성), `branchGuard.config.json`의 `protectedBranches`로 설정(기본 main·master). 회귀 테스트 4종
- **validateHarness 검사 확장** — 하네스 존재 시 branchGuard 미구성 warn

### Changed

- **절대 규칙 1에 예외 신설 (사용자 승인)** — "git 작업은 사용자 전담"의 유일한 예외로 **사용자 확인된 브랜치 전환**을 허용. `blockGitMutation`에서 `switch`를 차단 목록에서 제외하되, 작업 내용을 버릴 수 있는 플래그(`-f`/`--force`·`--discard-changes`·`-C`/`--force-create`)는 계속 차단. `checkout`은 파일 복원 기능이 있어 전체 차단 유지. 차단/허용 테스트 갱신
- **오케스트레이터 Phase 0 첫 단계에 작업 브랜치 확인 추가** — 산출물 확인 전에 branch 스킬로 브랜치 점검 (orchestrator-template / agent-design 작업 원칙)
- **hooks-and-permissions 재구성** — §3 브랜치 가드 신설(등록 JSON·config·한계: Bash 경유 쓰기는 지침 병행), 설치 절차 훅 3종 체제

## [1.8.0] - 2026-07-07

### Added

- **`digest` 스킬 (신규)** — 대형 파일·모듈 분석 결과를 세션 간 재사용하는 지식 캐시. 프롬프트 캐시가 세션 안에서만 사는 한계를 파일 기반(`docs/digests/{slug}.md`)으로 보완한다(절대 규칙 7의 세션 간 실행 수단). 소스별 **내용 해시**를 frontmatter에 기록하고 소비 전 신선도를 검증(fresh → 다이제스트만 소비 / stale → 바뀐 소스만 재읽기·갱신 / missing → 정리 확인), "다이제스트는 지도이지 원문 대체가 아니다"(수정 파일은 원문 필독) 원칙, 시크릿 기록 금지
- **신선도 검사기** (`skills/digest/scripts/checkFreshness.mjs`) — `hash <파일...>`(frontmatter 기록용 해시 출력) / `check <다이제스트> --root <경로>`(전 소스 판정 + 종료 코드) 두 서브커맨드. mtime이 아니라 sha256 내용 해시 12자리 — 체크아웃·복사에 오탐하지 않는다. node:test 회귀 테스트 7종
- **다이제스트 템플릿** (`skills/docs/assets/templates/digest.md`) — docs 스킬 템플릿 5종 체제. frontmatter(sources 해시) + 책임 / 공개 인터페이스 / 의존과 데이터 흐름 / 불변식과 함정 4섹션
- **하네스 내장** — Phase 2 템플릿 배포 5종 확장 + 리서치·분석 에이전트 정의에 "착수 전 `docs/digests/` 확인, 대형 분석 완료 시 다이제스트 기록" 명시. context-economy §3 생성 규칙 5가 digest 스킬을 가리키도록 갱신

### Changed

- **validateHarness 공통 템플릿 목록 확장** — digest.md 추가
- README docs 스킬 소개의 템플릿 종수 표기(3종)를 실제(5종)에 맞게 수정

## [1.7.0] - 2026-07-07

### Added

- **절대 규칙 7 — 컨텍스트 절약형 설계 (신규)** — 상시 로딩(CLAUDE.md·description)은 포인터 수준으로 최소화(CLAUDE.md ~200줄), 파일 한정 지침은 `.claude/rules/` + `paths:`로 조건부 로딩, 대량 읽기·리서치는 서브 에이전트 격리 후 요약만 회수, 대형 로그·데이터는 스크립트 전처리. 플랫폼이 자동으로 하는 것(프롬프트 캐시·CLAUDE.md 세션당 1회 로드·스킬/MCP 지연 로딩)은 재구현 금지
- **컨텍스트 경제 가이드** (`references/context-economy.md`) — (1) Claude Code 자동 메커니즘 표(프롬프트 캐시 ~10% 단가·TTL 리셋, 지연 로딩, 자동 컴팩션)와 재구현 금지 원칙, (2) 캐시를 깨는 행동(모델·effort 전환, MCP 연결/해제, 컴팩션) vs 유지하는 행동 — 루프 설계 시 회피 지침, (3) 상시/조건부 로딩 5층 구조와 생성 규칙 5종, (4) 측정 수단(/context·/usage·검증자 게이트 maxTokens)
- **Phase 3 검증에 컨텍스트 경제 점검 추가** — CLAUDE.md ~200줄, rules 분리, 대량 읽기 격리 확인. 산출물 체크리스트에 컨텍스트 경제 항목 추가

### Changed

- **에이전트 템플릿·오케스트레이터 골격에 컨텍스트 경제 반영** — 작업 원칙에 "대량 읽기는 서브 에이전트 위임 + 요약 회수, 대형 로그는 스크립트 전처리" 추가 (agent-design / orchestrator-template). 오케스트레이터 절대 규칙에 "반복 실행 중 모델·effort 전환 금지(캐시 무효화)" 명시

## [1.6.0] - 2026-07-06

### Added

- **`loop` 스킬 (신규)** — 반복·수렴형 요청을 루프 명세(트리거/실행 단위/검증자/종료 규칙 + 안전장치)로 설계하고 실행 수단(/goal·/loop·검증자 게이트·Workflow 반복)에 매핑하는 루프 설계 스킬. 자기평가 금지(기계적 검증만), **4요소 사용자 확인 필수**(확인 전 실행 금지), 생성자·검증자 분리, 막힘 시 handoff 인계
- **검증자 게이트 훅** (`assets/hooks/verifierGate.mjs`) — TDD 종료 게이트를 config 기반으로 일반화한 Stop 훅. `checks`(테스트·타입체크·린트 등 조합) 실패 시 턴 종료 차단, **`maxTokens`(transcript 누적 토큰)·`maxIterations` 도달 시 루프를 계속하지 않고 자동 중단 → 진행 상황·남은 실패·사유 보고 후 종료**. 문서 코드블록 템플릿(gateTestsOnStop) 방식 폐지, 회귀 테스트 6종 추가 (hooks.test 4종 → 10종)
- **루프 명세 템플릿** (`skills/docs/assets/templates/loop-spec.md`) — docs 스킬 템플릿 4종 체제. 목표(검증 가능한 종료 상태) / 루프 설계(4요소 + 사용자 확인 필드) / 안전장치(최대 반복·토큰 예산·막힘 판정) / 실행 기록 / 종료 보고
- **실행 모드에 루프 추가** — execution-modes 결정 트리 최상단에 반복·수렴형 판별 추가("종료를 기계적으로 검증할 수 있는가"), §5 루프 섹션 신설, 패턴 매핑에 반복 수렴 행 추가. SKILL.md Phase 1 모드 표에 루프 행 + "루프는 사용자 확인이 선행된다" 규칙

### Changed

- **hooks-and-permissions §4 재작성** — TDD 종료 게이트 → 검증자 게이트. 판정 순서(통과=허용 → 안전장치=보고 후 종료 → 실패=차단) 명문화
- **validateHarness 공통 템플릿 목록 확장** — loop-spec.md 추가

## [1.5.0] - 2026-07-06

### Added

- **`handoff` 스킬 (신규)** — 진행 중 작업을 인계 문서(목표/진행 상황/시도와 결과/다음 단계/미해결 질문)로 옮겨 세션 간 연속성을 보장하는 스킬. 작성·갱신/인수 두 모드, 작업 흐름당 1개 갱신형 문서(`docs/handoff/{slug}.md`), "시도와 결과" 누적 기록(막다른 길 반복 방지), 인수 시 근거 파일 실검증, 완료 시 워크로그로 최종 기록 이관
- **인계 템플릿** (`skills/docs/assets/templates/handoff.md`) — docs 스킬 템플릿 3종 체제(worklog + retro + handoff)
- **오케스트레이터 에러 핸들링에 인계 추가** — 세션 중단·컨텍스트 한계 임박 시 handoff 스킬로 인계 문서 작성 후 중단 (orchestrator-template / SKILL.md Phase 2)

### Changed

- **validateHarness 공통 템플릿 목록 확장** — worklog·retro에 handoff 추가

## [1.4.0] - 2026-07-06

### Added

- **`retro` 스킬 (신규)** — 하네스 실행 산출물(워크로그·qa-report·이전 회고)을 근거로 잘된 점·반복 문제를 분석하고 에이전트 정의·스킬·오케스트레이터·description의 개선안을 도출하는 회고 스킬. 제안 → 승인 → 적용 원칙(자동 적용 금지), 근거 산출물 병기 의무, 이전 회고 대비 재발 추적, 적용 후 validateHarness 재검증 포함. "하네스는 진화하는 시스템" 원칙(Phase 4)의 실행 수단
- **회고 템플릿** (`skills/docs/assets/templates/retro.md`) — docs 스킬 템플릿 2종 체제(worklog + retro). 잘된 점 / 반복 문제 / 개선안(상태 추적 표: 제안→승인→적용/보류) / 적용 결과 4섹션
- **오케스트레이터 종료 절차에 회고 제안** — 생성되는 오케스트레이터 골격에 종료 단계(결과 보고 + 커밋 안내 + 회고 제안) 추가 (orchestrator-template / SKILL.md Phase 2·4)

### Changed

- **validateHarness 템플릿 검사 일반화** — worklog 단일 검사를 공통 템플릿 목록(worklog·retro) 순회로 확장. 템플릿별 개별 warn

## [1.3.0] - 2026-07-06

### Added

- **`docs` 스킬 (신규)** — 모든 작업을 공통 워크로그 템플릿(1.개요 / 2.작업내용 / 3.주의사항)으로 기록하는 두 번째 스킬. 템플릿은 `skills/docs/assets/templates/worklog.md` 실물 파일로 번들(훅과 같은 결정적 복사 방식). 단일 출처 규칙(프로젝트 사본 `docs/templates/worklog.md` 우선), 병렬 에이전트 파일 분리(`-{agent}` 접미사), 기존 기록 후속 갱신 절차, 시크릿 기록 금지 포함
- **하네스 워크로그 내장** — Phase 2에 템플릿 배포 단계(5) 추가: 생성되는 하네스의 `docs/templates/worklog.md`로 복사되고, 에이전트 정의·오케스트레이터에 "작업 완료 시 워크로그 기록" 규칙이 명시된다(절대 규칙 3의 기록 형식 구체화). agent-design / orchestrator-template / 산출물 체크리스트 반영
- **validateHarness 검사 1종 확장** — 하네스 존재 시 `docs/templates/worklog.md` 부재 warn. 테스트 17종 → 19종

## [1.2.0] - 2026-07-02

### Changed

- **에이전트 팀 API 현행화** — `TeamCreate`/`TeamDelete` 기반 골격을 현행 모델(암시적 단일 팀 + `Agent(name)` 스폰 + `SendMessage` 컨텍스트 유지 + `TaskCreate` 공유 작업 목록)로 교체. `team_name` 파라미터 deprecated 명시, Phase 전환은 새 팀원 스폰으로 (execution-modes / orchestrator-template / SKILL.md)
- **git 차단 훅 우회 봉합** — `git -C <path> commit`·`git -c <k=v> push`처럼 값을 별도 인자로 받는 전역 플래그가 판정 정규식을 우회하던 결함 수정, `worktree` 추가
- **agentType dead-link 검사를 error → warn으로 조정** — 새 빌트인 타입 오탐이 통과 기준(error 0건)을 깨지 않도록. 메시지에 커스텀/빌트인 분기 안내 포함

### Added

- **훅 스크립트 번들** (`assets/hooks/`) — `blockGitMutation.mjs` + `blockSecretAccess.mjs`를 실물 파일로 배포, 문서 코드블록 복사 방식 폐지. 회귀 테스트 4종(`scripts/hooks.test.mjs`) 포함
- **시크릿 Bash 우회 차단 훅** (`blockSecretAccess.mjs`) — permissions.deny는 Read 도구만 막고 `cat .env` 같은 Bash 경유 읽기는 통과하던 구멍을 PreToolUse 훅으로 봉합. `.env.example` 등 예시 파일은 허용
- **TDD 종료 게이트 (Stop 훅, 선택)** — 테스트 실패 상태로 턴 종료를 차단해 절대 규칙 2를 기계적으로 강제. `stop_hook_active` 무한 루프 가드 포함 (hooks-and-permissions.md)
- **Workflow 최신 기능 반영** — `.claude/workflows/` 저장 워크플로우를 Workflow 모드 산출물로, `resumeFromRunId` 캐시 재개를 부분 재실행 수단으로, `scriptPath` 반복 수정, `workflow()` 중첩 호출, `opts.effort` 정책(세션 상속 기본), journal.jsonl 디버깅 (execution-modes / orchestrator-template / agent-design)
- **validateHarness 검사 4종 확장** — (1) 하네스 존재 시 git 훅·시크릿 deny 미구성 warn, (2) `.claude/commands/` 파일 존재 warn, (3) 오케스트레이터 스킬의 `## 테스트 시나리오` 섹션 부재 warn, (4) frontmatter 멀티라인 값(`>-` 블록 스칼라·들여쓴 연속 줄) 파싱 지원. 테스트 12종 → 17종

### Fixed

- plugin.json·marketplace.json description의 팀 중심 구식 표현("에이전트 팀과 스킬 세트")을 모드 중립 표현("에이전트 정의와 스킬 세트")으로 통일

## [1.1.0] - 2026-06-10

### Added

- **훅·권한 가이드** (`references/hooks-and-permissions.md`) — 절대 규칙 1(git)·6(시크릿)을 PreToolUse 훅 + permissions deny로 기계적으로 강제, 테스트·빌드 명령 allowlist로 자율 실행 보장, 기존 설정 병합 규칙. Phase 2에 훅·권한 구성 단계 추가
- **인자 해석** — `/harness <인자>` 슬래시 명령어 호출 시 인자(구축/점검/추가/해체 등)로 Phase 0 분기를 선결정하는 표
- **해체(teardown) 분기** — Phase 0에 네 번째 분기 추가. 참조 제거 → 파일 삭제 순서, CLAUDE.md 정리, 산출물 처분 사용자 확인, 재검증의 5단계 역순 절차
- **validateHarness 검사 3종 확장** — (1) 스킬 본문의 `agentType`/`agent_type`/`subagent_type` 참조 ↔ 에이전트 정의 실존 대조(error), (2) description 후속 작업 키워드 누락(warn), (3) CLAUDE.md 하네스 포인터 부재(warn). 테스트 7종 → 12종
- **절대 규칙 6 — 시크릿 차단** — `.env`·credential 읽기 금지, 산출물에 토큰/키 기록 금지. SKILL.md·에이전트 템플릿·오케스트레이터 템플릿에 반영
- README에 슬래시 명령어 사용법(`/guksu-harness:harness <요청>`) 추가

## [1.0.0] - 2026-06-10

### Added

- `harness` 메타 스킬 초기 릴리스 — 감사 → 설계 → 구축 → 검증 → 등록·진화 5 Phase
- **Workflow 1급 실행 모드** — 결정적 오케스트레이션(pipeline/parallel, 스키마 출력, 토큰 버짓)을 에이전트 팀·서브 에이전트와 동급 선택지로, "제어 흐름을 코드로 쓸 수 있는가" 결정 트리 포함 (`references/execution-modes.md`)
- **모델 정책 현대화** — 모델 하드코딩 금지, 세션 모델 상속 기본, 오버라이드는 이유 명시 시에만
- **절대 규칙 5종 내장** — git 사용자 전담 / TDD 기본 / 파일 기반 산출물 / 단일 출처 문서 / 경계면 교차검증 incremental QA
- `validateHarness.mjs` 구조 검증기 + node:test 테스트 7종 (frontmatter, name-디렉토리 일치, references 링크, 500줄 경고, manifest 버전 정합성)
- references 5종 — execution-modes / agent-design / skill-authoring / orchestrator-template / testing-guide
- 플러그인 마켓플레이스 배포 형태 (`.claude-plugin/marketplace.json` + `plugin.json`)
