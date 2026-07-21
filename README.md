# guksu-harness

> Guksu의 하네스 아키텍트 — 도메인 요청을 **에이전트(누가) + 스킬(어떻게) + 오케스트레이션(언제, 어떤 순서로)**으로 변환하는 Claude Code 메타 스킬.

기존 하네스 팩토리 계열 플러그인이 에이전트 팀만을 전제하던 시절의 설계라, 현 시점의 Claude Code 프리미티브(Workflow 결정적 오케스트레이션, 스키마 강제 출력, 세션 모델 상속)를 반영해 처음부터 다시 만들었다.

## 무엇이 다른가

| 영역 | 기존 하네스 플러그인 | guksu-harness |
|------|--------------------|---------------|
| 실행 모드 | 에이전트 팀이 무조건 기본 | **단일 우선 에스컬레이션** — 직접 실행→서브→루프→Workflow→팀 순으로, 더 싼 모드가 안 되는 근거가 있을 때만 상향 (멀티에이전트는 ~15배 토큰) |
| Workflow 도구 | 미지원 | **1급 실행 모드** — pipeline/parallel, 스키마 검증 출력, 토큰 버짓 |
| 모델 정책 | `model: "opus"` 하드코딩 | **세션 모델 상속이 기본** — 모델 세대가 바뀌어도 하네스가 늙지 않는다 |
| 작업 스타일 | 없음 | **절대 규칙 내장** — TDD 기본, git 사용자 전담, 경계면 교차검증 QA, 파일 기반 산출물 |
| 작업 기록 | 형식 자유 (에이전트마다 제각각) | **공통 워크로그 템플릿** — `docs` 스킬 + 생성되는 하네스에 자동 배포 |
| 진화 | 지침 한 줄 | **`retro` 스킬** — 산출물 근거 회고 + 제안→승인→적용 |
| 세션 연속성 | 없음 | **`handoff` 스킬** — 인계 문서로 세션 간 컨텍스트 이어받기 |
| 루프 | 없음 (수동 반복 지시) | **`loop` 스킬** — 4요소 명세 + 검증자 게이트 + 토큰 예산 자동 중단 |
| 컨텍스트 비용 | 통제 없음 | **컨텍스트 경제 내장** — 상시/조건부 로딩 분리, CLAUDE.md ~200줄, 대량 읽기 서브 에이전트 격리 (절대 규칙 7) |
| 세션 간 재사용 | 없음 (매 세션 재분석) | **`digest` 스킬** — 분석 요약을 내용 해시 검증 캐시(`docs/digests/`)로 저장, 다음 세션이 원문 대신 소비 |
| 브랜치 위생 | 없음 (main 위에서 그대로 작업) | **`branch` 스킬 + branchGuard 훅** — 작업 시작 시 브랜치 확인·승인 후 전환, 보호 브랜치 편집은 기계적 차단 |
| 커밋·PR | 없음 (전부 수동) 또는 통제 없는 자동 커밋 | **`pr` 스킬 + 훅 옵트인** — 사용자 명시 요청 시에만 커밋·PR 업로드(git-flow: main·dev·feat, 베이스는 dev), Claude 작성 표기가 든 커밋은 기계적 차단 |
| 종료 보고 | 채팅 장문 텍스트 (스크롤에 묻힘) | **`report` 스킬** — 요약·검증·검토 필요·후속 조치를 담은 HTML 보고서를 `docs/reports/`에 히스토리로 누적, 채팅엔 요약만 |
| 방법론 근거 | 저자 경험 | **업계 검증 반영** — Anthropic·OpenAI·Google 공식 가이드 + Airbnb·Shopify 프로덕션 사례로 실행 모드·가드레일·검증 서열을 정합 |
| 본문 크기 | SKILL.md 458줄 | **~150줄** — 세부는 references/ 7종으로 분리 (Progressive Disclosure) |
| 구조 검증 | 수동 체크리스트 | **`validateHarness.mjs`** — frontmatter·참조 링크·훅/템플릿 구성·버전 정합성 자동 검사 (회귀 테스트 50종) |

## 설치

```
/plugin marketplace add Guksu/guksu-harness
/plugin install guksu-harness@guksu-harness
```

기존 하네스 플러그인을 쓰고 있었다면 트리거 충돌을 피하기 위해 제거한다:

```
/plugin uninstall harness@harness-marketplace
```

## 사용

**슬래시 명령어 (권장)** — 플러그인 스킬은 자동으로 슬래시 명령어로 노출되므로 별도 설정 없이 바로 쓸 수 있다. 자연어 트리거보다 확실하게 스킬을 실행한다:

```
/guksu-harness:harness 이 프로젝트에 하네스 구축해줘
/guksu-harness:harness 점검
/guksu-harness:harness QA 에이전트 추가
```

(이름이 다른 명령어와 겹치지 않으면 `/harness ...`로 줄여 입력해도 된다)

**자연어 트리거** — description 매칭으로도 동작한다:

```
> 이 프로젝트에 하네스 구축해줘
> 하네스 점검해줘 / 에이전트·스킬 동기화해줘
> QA 에이전트 추가해줘
```

스킬이 트리거되면 **감사 → 설계 → 구축 → 검증 → 등록·진화**의 5단계로 진행하며, 결과물로 프로젝트에 `.claude/agents/`(에이전트 정의), `.claude/skills/`(오케스트레이터), `.claude/hooks/`+permissions(훅·권한), `docs/templates/`(공통 템플릿 5종), CLAUDE.md 포인터가 생성된다.

## docs 스킬 — 공통 워크로그 기록

모든 작업을 하나의 공통 템플릿(**1. 개요 / 2. 작업내용 / 3. 주의사항**)으로 기록하는 독립 스킬. 형식이 통일되어야 에이전트 간·세션 간에 서로의 기록을 예측 가능하게 소비할 수 있다.

```
/guksu-harness:docs 오늘 작업 기록해줘
> 이번 작업 워크로그 남겨줘 / 아까 기록 보완해줘
```

- 템플릿은 `skills/docs/assets/templates/`에 실물 파일로 번들(worklog + retro + handoff + loop-spec + digest + report 6종) — 프로젝트 `docs/templates/` 사본이 있으면 그것이 단일 출처
- 기록 위치: `docs/worklog/{YYYY-MM-DD}-{slug}.md` (병렬 에이전트는 `-{agent}` 접미사로 각자 파일)
- 하네스가 생성하는 프로젝트에는 Phase 2에서 템플릿이 자동 배포되고, 각 에이전트 정의에 "작업 완료 시 워크로그 기록"이 명시된다

## retro 스킬 — 회고 기반 하네스 진화

하네스 실행 산출물(워크로그·qa-report·이전 회고)을 분석해 반복 문제를 찾고, 에이전트 정의·스킬·오케스트레이터·description의 구체적 개선안을 **제안 → 승인 → 적용**으로 반영하는 독립 스킬. "하네스는 진화하는 시스템" 원칙의 실행 수단이다.

```
/guksu-harness:retro 하네스 회고해줘
> 이번 스프린트 뭐가 문제였는지 분석해줘 / 지난 회고 개선안 적용해줘
```

- 모든 개선안에 근거 산출물 병기 — 근거를 답할 수 없는 개선안은 제안하지 않는다
- 이전 회고(`docs/retro/`)와 대조해 재발 문제의 우선순위를 올린다
- 자동 적용 금지 — 사용자가 승인한 항목만 적용하고 CLAUDE.md 변경 이력에 기록, validateHarness로 재검증
- 하네스가 생성하는 오케스트레이터는 종료 시 회고를 제안한다 (강요하지 않음)

## handoff 스킬 — 세션 인계

진행 중인 작업의 상태(목표/진행 상황/시도와 결과/다음 단계/미해결 질문)를 인계 문서로 옮겨, 컨텍스트가 사라져도 다음 세션이 이어받게 하는 독립 스킬. 독자는 대화를 보지 못한 새 세션이라는 전제로 쓴다.

```
/guksu-harness:handoff 인계 문서 작성해줘
> 세션 정리해줘 / 이어서 해줘 / 어디까지 했었지
```

- 작업 흐름당 1개 갱신형 문서(`docs/handoff/{slug}.md`) — 인계 문서가 여러 개면 최신을 알 수 없다
- "시도와 결과"는 누적 기록 — 다음 세션이 같은 막다른 길을 반복하지 않게
- 인수 시 근거 파일을 실제로 열어 문서와 현실의 일치를 검증한 뒤 착수
- 작업 완료 시 상태를 "완료"로 바꾸고 최종 기록은 워크로그로 — 인계 문서는 진행 중 스냅샷, 워크로그가 완결 기록

## loop 스킬 — 루프 설계

"~할 때까지 반복해줘/알아서 계속 고쳐줘" 같은 반복·수렴형 요청을 **루프 명세**(트리거/실행 단위/검증자/종료 규칙 + 안전장치)로 설계하고 실행 수단(`/goal`·`/loop`·검증자 게이트·Workflow 반복)에 매핑하는 독립 스킬. 프롬프트가 아니라 루프를 설계한다.

```
/guksu-harness:loop 테스트 전부 통과할 때까지 고치는 루프 만들어줘
> 린트 클린될 때까지 알아서 반복해줘
```

- **자기평가 금지** — 종료 판정은 기계적 검증(명령 종료 코드)만. 검증 불가 목표는 루프로 만들지 않는다
- **4요소는 사용자 확인 필수** — 트리거·실행 단위·검증자·종료 규칙을 확인받기 전에는 실행하지 않는다
- **토큰 예산 안전장치** — 예산 초과 시 루프를 계속하지 않고 자동 중단, 진행 상황·남은 실패·사유 보고 후 종료
- **검증자 게이트**(Stop 훅, `assets/hooks/verifierGate.mjs`) — 검증 실패 시 턴 종료 차단, 안전장치(토큰 예산 `maxTokens`·최대 반복 `maxIterations`·막힘 `stuckAfter` — 같은 실패 시그니처 N연속) 도달 시 "보고 후 종료" 지시. TDD 게이트의 일반화(테스트+타입체크+린트 등 조합 가능)

## digest 스킬 — 세션 간 지식 캐시

프롬프트 캐시는 세션 안에서만 산다 — 세션이 바뀌면 같은 대형 파일을 처음부터 다시 읽는다. 이 스킬은 대형 파일·모듈의 분석 결과를 다이제스트(`docs/digests/{slug}.md`)로 저장하고, 다음 세션이 원문 대신 다이제스트를 먼저 소비해 반복 분석 토큰을 없앤다. handoff가 "작업 상태"의 캐시라면 digest는 "코드 이해"의 캐시다.

```
/guksu-harness:digest 이 모듈 다이제스트 만들어줘
> 코드 요약 캐싱해줘 / 다이제스트 갱신해줘
```

- **신선도는 내용 해시로 판정** — 소스별 해시를 frontmatter에 기록하고, 사용 전 `scripts/checkFreshness.mjs`로 fresh/stale/missing을 검증한다 (mtime은 체크아웃만으로 바뀌므로 쓰지 않는다)
- **stale이면 바뀐 소스만** 다시 읽고 다이제스트를 갱신 — 전체 재작성 아님
- **다이제스트는 지도이지 원문 대체가 아니다** — 수정할 파일은 원문을 읽는다
- 하네스 연동: 리서치·분석 에이전트 정의에 "착수 전 `docs/digests/` 확인 + 대형 분석 완료 시 다이제스트 기록"이 명시된다 (절대 규칙 7의 세션 간 실행 수단)

## branch 스킬 — 작업 브랜치 확인

보호 브랜치(main 등) 위에서 시작된 작업은 커밋 시점에야 발견된다 — 그때는 이미 변경이 쌓여 있다. 이 스킬은 **작업 시작 시점**에 현재 브랜치를 점검하고, 보호 브랜치라면 어떤 브랜치로 이동/생성할지 사용자 확인을 받은 뒤 전환한다.

```
/guksu-harness:branch 새 브랜치에서 작업하자
> 브랜치 파줘 / 지금 어느 브랜치야? 옮겨서 작업해줘
```

- **확인 없이 전환하지 않는다** — 이름은 제안(기존 브랜치 패턴 우선, 없으면 `{type}/{slug}`), 결정은 사용자
- **`git switch(-c)`만 사용** — 절대 규칙 1의 유일한 예외. switch는 로컬 변경과 충돌하면 스스로 거부하므로 작업 내용을 파괴하지 않는다. 파괴·이탈 플래그(`-f`·`--discard-changes`·`-C`·`--orphan`·`-d`/`--detach`)와 `checkout`·`restore`·`clean`은 훅이 계속 차단(번들 `-fc`·붙임 `-Cmain`·따옴표 형태 포함)
- **branchGuard 훅**(`assets/hooks/branchGuard.mjs`)이 보호 브랜치 위 파일 편집(Edit/Write/NotebookEdit)을 기계적으로 차단 — `.git/HEAD` 직접 판독(worktree 지원), `branchGuard.config.json`의 `protectedBranches`로 설정(기본 main·master)
- 커밋·푸시·병합·브랜치 삭제는 여전히 사용자 전담 (사용자 명시 요청 시의 커밋·PR 업로드는 `pr` 스킬)

## pr 스킬 — 커밋·PR 업로드 (사용자 명시 요청 시)

기본값은 여전히 "git은 사용자 전담"이다. 이 스킬은 사용자가 **명시적으로 요청한 경우에만** 에이전트가 커밋 메시지를 작성해 commit·push하고 PR을 생성하는, 절대 규칙 1의 두 번째 예외다.

```
/guksu-harness:pr 커밋하고 PR 올려줘
> 이 작업 커밋해줘 / dev로 PR 만들어줘
```

- **명시 요청 없이는 발동하지 않는다** — 작업이 끝났다고 알아서 커밋하지 않는다
- **커밋 메시지·PR 본문에 Claude 작성 표기 절대 금지** — `Co-Authored-By: Claude`·`🤖 Generated with [Claude Code]`·`Claude-Session` 등 어떤 형태든 제거한다. 훅이 표기가 든 커밋을 기계적으로 차단한다
- **git-flow: main ← dev ← feat** — 작업은 `feat/{slug}`에서, PR 베이스는 `dev`. `dev → main`(릴리스)·머지는 사용자 전담
- **훅 옵트인과 한 쌍** — `blockGitMutation.config.json`의 `{ "allowCommitPush": true }`가 있어야 commit·push가 열린다(하네스 구축 시 사용자 확인 후 구성). 활성 상태에서도 merge·rebase·reset·force/delete push·`--amend`·간접 메시지 플래그(`-F`/`-t`/`-c`/`-C`)는 계속 차단
- 커밋은 Conventional Commits(`{type}: {요약}`), 메시지는 `-m` 인라인으로만 — 훅이 메시지를 검사할 수 있는 유일한 형태다

## report 스킬 — 작업 종료 HTML 보고서

작업 종료 보고를 채팅 장문 텍스트 대신 **파일로 남는 HTML 문서**로 전환하는 독립 스킬. 채팅 보고는 스크롤에 묻히고 세션과 함께 사라진다 — 보고서는 `docs/reports/{YYYY-MM-DD}-{slug}.html`로 누적되어 스프린트 문서처럼 히스토리가 된다.

```
/guksu-harness:report 이번 작업 보고서 만들어줘
> 결과 HTML로 정리해줘 / 보고서 갱신해줘
```

- **5개 고정 섹션** — 1.요약 / 2.작업 내용 / 3.검증 결과 / **4.사용자 검토 필요**(결정 대기 항목 — 선택지·영향·기본 동작 병기) / **5.후속 조치**(트리거·담당 명시)
- **중립 테마 고정** — 백지·슬레이트·표준 상태색(완료=녹색·검토=호박색·후속=청색)의 문서 스타일. 형식이 통일되어야 히스토리로 소비된다
- **작업 종료 시 항상 생성** — 규모로 생략을 판단하지 않는다(작은 보고서가 쌓여야 히스토리가 끊기지 않는다). 채팅 보고는 요약으로 축소 — 3~5문장 + 보고서 경로 + 검토 항목 수만
- 워크로그(md)가 정본 기록이고 보고서는 검토용 뷰 — slug를 워크로그와 맞춰 쌍으로 추적, 삭제하지 않고 누적(감사 추적)

## 생성되는 모든 하네스에 내장되는 절대 규칙

1. **git 작업은 사용자 전담** — 에이전트는 commit·push 등 git 변경 명령을 절대 수행하지 않는다. (예외 ①: 사용자 확인된 브랜치 전환 — `branch` 스킬이 `git switch(-c)`로만 수행. 예외 ②: 사용자가 명시 요청한 커밋·PR 업로드 — `pr` 스킬이 git-flow(main·dev·feat)로 수행하며, 커밋 메시지·PR 본문에 Claude 작성 표기는 절대 넣지 않는다)
2. **코드 생성 하네스는 TDD 기본** — 인수조건 = 테스트 케이스 (Red→Green→Refactor).
3. **산출물은 파일 기반** — 중간 산출물 보존, 감사 추적 가능.
4. **단일 출처 문서 준수** — 설계·컨벤션 문서와 어긋나면 사용자에게 확인.
5. **QA는 경계면 교차검증 + incremental** — 생산자↔소비자 shape 비교, 모듈 완성 직후마다.
6. **시크릿 읽기·기록 금지** — `.env`·credential을 읽지 않고 산출물에 토큰/키를 남기지 않는다.
7. **컨텍스트 절약형 설계** — 상시 로딩(CLAUDE.md·description)은 포인터 수준, 파일 한정 지침은 `.claude/rules/`+`paths:`로, 대량 읽기는 서브 에이전트 격리. 플랫폼이 자동으로 하는 것(프롬프트 캐시·지연 로딩)은 재구현하지 않는다.

규칙 1(git)·6(시크릿)과 브랜치 위생은 지침에 그치지 않고 **기계적으로 강제**된다 — `assets/hooks/`의 PreToolUse 훅 3종(git 변경 차단, `cat .env` 같은 Bash 경유 시크릿 접근 차단, 보호 브랜치 편집 차단)이 생성되는 하네스의 `.claude/hooks/`로 복사되고, Read 도구 측은 permissions deny가 막는다. git 차단 훅의 commit·push 예외는 `blockGitMutation.config.json`(`allowCommitPush`) 옵트인으로만 열리며, 열린 상태에서도 Claude 작성 표기가 든 커밋·검사 불가 커밋 형태·force/delete push·나머지 변경 명령은 계속 차단된다. 코드 생성·루프 하네스에는 검증자 게이트(Stop 훅, `verifierGate.mjs`)를 선택 적용할 수 있다 — 검증 명령(테스트·타입체크·린트 등 조합) 통과까지 턴 종료를 차단하고, 안전장치(토큰 예산·최대 반복·막힘 판정) 도달 시엔 반대로 자동 중단시켜 보고 후 종료하게 한다.

## 구조

```
guksu-harness/
├── .claude-plugin/
│   ├── marketplace.json
│   └── plugin.json
├── skills/docs/
│   ├── SKILL.md                      # 공통 워크로그 기록 (개요/작업내용/주의사항)
│   └── assets/templates/
│       ├── worklog.md                # 공통 워크로그 템플릿 (생성 하네스로 복사됨)
│       ├── retro.md                  # 공통 회고 템플릿 (retro 스킬이 사용)
│       ├── handoff.md                # 공통 인계 템플릿 (handoff 스킬이 사용)
│       ├── loop-spec.md              # 공통 루프 명세 템플릿 (loop 스킬이 사용)
│       ├── digest.md                 # 공통 다이제스트 템플릿 (digest 스킬이 사용)
│       └── report.html               # 공통 HTML 보고서 템플릿 (report 스킬이 사용)
├── skills/branch/
│   └── SKILL.md                      # 작업 브랜치 확인 (사용자 승인 후 git switch)
├── skills/pr/
│   └── SKILL.md                      # 커밋·PR 업로드 (사용자 명시 요청 시, git-flow: main·dev·feat)
├── skills/report/
│   └── SKILL.md                      # 작업 종료 HTML 보고서 (요약·검토 필요·후속 조치)
├── skills/digest/
│   ├── SKILL.md                      # 세션 간 지식 캐시 (작성·갱신 / 소비 두 모드)
│   └── scripts/
│       ├── checkFreshness.mjs        # 다이제스트 신선도 검사기 (내용 해시 기반)
│       └── checkFreshness.test.mjs
├── skills/retro/
│   └── SKILL.md                      # 회고·진화 (산출물 분석 → 제안 → 승인 → 적용)
├── skills/handoff/
│   └── SKILL.md                      # 세션 인계 (작성·갱신 / 인수 두 모드)
├── skills/loop/
│   └── SKILL.md                      # 루프 설계 (4요소 사용자 확인 + 안전장치 + 게이트)
└── skills/harness/
    ├── SKILL.md                      # 핵심 워크플로우 (5 Phase + 인자 해석 + 해체 절차)
    ├── references/
    │   ├── execution-modes.md        # 에스컬레이션 사다리·결정 트리·마이그레이션 패턴 (핵심)
    │   ├── agent-design.md           # 분리 기준 4축, 정의 템플릿, QA 가이드
    │   ├── skill-authoring.md        # description 트리거, progressive disclosure
    │   ├── orchestrator-template.md  # 모드별 골격, 데이터 전달, 에러 핸들링
    │   ├── hooks-and-permissions.md  # 절대 규칙의 기계적 강제 (훅·deny·allowlist)
    │   ├── context-economy.md        # 토큰 절약 설계 (상시/조건부 로딩, 캐시, digest 연동)
    │   └── testing-guide.md          # 구조·트리거·실행 테스트
    ├── assets/hooks/
    │   ├── blockGitMutation.mjs      # git 변경 차단 훅 (commit·push 예외는 config 옵트인 — pr 스킬과 한 쌍)
    │   ├── blockSecretAccess.mjs     # Bash 경유 시크릿 접근 차단 훅
    │   ├── branchGuard.mjs           # 보호 브랜치 편집 차단 훅 (branch 스킬과 한 쌍)
    │   └── verifierGate.mjs          # 검증자 게이트 Stop 훅 (종료 규칙 + 토큰 예산 강제)
    └── scripts/
        ├── validateHarness.mjs       # 하네스 구조 검증기
        ├── validateHarness.test.mjs
        └── hooks.test.mjs            # 훅 차단/허용 회귀 테스트
```

## 개발

```bash
# 검증기 + 훅 + 다이제스트 신선도 테스트
node --test skills/harness/scripts/validateHarness.test.mjs skills/harness/scripts/hooks.test.mjs skills/digest/scripts/checkFreshness.test.mjs

# 이 repo 자체를 검증 (셀프 호스팅 — 하네스가 자기 규칙을 통과해야 한다)
node skills/harness/scripts/validateHarness.mjs .
```

## License

MIT © Guksu
