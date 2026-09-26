# 설계: 팀 맞춤 하네스 구성 (진단 → 결정 → 명세 → 적용 → 확인)

| 항목 | 내용 |
|------|------|
| 최종 갱신 | 2026-09-26 |
| 상태 | 승인됨 (2026-09-26, 사용자가 MVP 구현을 승인) — 첫 MVP 구현 완료(`teamCompose.mjs`, 인수 시나리오 테스트 고정) |
| 참여 | Guksu · Claude(작성) |

## 1. 목표와 완료 기준

지금의 guksu-harness는 정해진 파일을 설치하고 팀 수정본을 보존하며 갱신하는 도구다. 이번 설계는 여기에 "저장소와 팀의 일하는 방식을 읽고, 그 팀에 맞는 하네스를 구성한 뒤, 어디까지 작동하는지 보여 주는" 흐름을 얹는다.

사용자는 이렇게 요청한다: "우리 저장소를 분석하고, 우리 팀이 Claude Code와 Codex로 일할 때 필요한 하네스를 구성해줘."

완료 기준:

- 저장소에서 알 수 있는 것은 도구가 직접 조사하고, 팀만 아는 결정만 묻는다. 명시된 기존 정책은 다시 묻지 않는다.
- 팀 결정을 한 곳(구성 명세)에 적으면 훅 설정값·팀 규칙 문서·규칙 포인터가 그 명세에서 일관되게 생성된다. 같은 정책을 여러 파일에서 따로 고치지 않는다.
- 같은 구성을 다시 적용하면 변경 0건이다. 정책 하나를 바꾸면 그 정책이 닿는 파일만 바뀐다.
- 미리보기 이후 파일이 바뀌었거나 팀이 생성 구간을 손으로 고쳤으면 적용을 멈춘다. 적용 실패는 기존 백업·복원으로 되돌린다.
- 작동 확인 결과가 "설정 완료 / 실행 확인 / 확인 필요 / 실패" 네 상태로 구분되고, 훅 스크립트 시험을 앱 통합 확인으로 보고하지 않는다.
- 아래 §7 인수 시나리오 3종이 자동 테스트로 고정되어 통과한다.

## 2. 범위

**포함 (첫 MVP — "기존 저장소에 팀 맞춤 하네스를 처음 도입하기"):**

- 명령 3개: `diagnose`(진단, 읽기만) · `compose`(결정 반영·명세 저장·미리보기·적용) · `verify`(작동 확인).
- 네 영역: 작업 규칙(기존 지침·브랜치 관례·AI 작업 범위), 변경 보호(보호 브랜치·커밋·푸시 정책), 검증(실제 테스트·빌드·린트 명령과 완료 조건), 기록·인계(팀이 원할 때만).
- 구성 명세 파일 `.agents/harness-team.json`과 그 파일에서 생성하는 훅 설정 3종, `docs/harness-rules.md`의 생성 구간, `CLAUDE.md`·`AGENTS.md`의 포인터 구간.
- 대화 스킬(`harness`)에 이 흐름 연결.

**제외 (후속):**

- 프론트엔드 전용 구성, 범용 스킬 생성, 다중 에이전트 운영, 조직 전체 관리, 자동 감시.
- 여러 저장소 동시 구성. 명세는 export/import 묶음에 실리지만 다른 저장소에서의 재진단·충돌 처리는 이번에 다루지 않는다.
- 훅 스크립트 자체의 변경. 훅은 그대로 두고 설정값만 생성한다.
- 실제 Claude Code·Codex 앱 안의 훅 실행 확인(이 환경에서 불가 — 절차만 제공).

## 3. 시스템 구조

용어:

- 진단(diagnose): 저장소를 읽어 사실·추정·미확인 결정·충돌을 나누는 일. 파일을 바꾸지 않는다.
- 결정(decision): 팀만 정할 수 있는 항목. 키 이름으로 부른다(예: `protection.allowCommitPush`).
- 구성 명세(spec): 결정과 그 근거, 생성한 파일의 해시를 담은 `.agents/harness-team.json`. 팀 소유 파일이며 커밋한다.
- 생성 구간: `docs/harness-rules.md`·`CLAUDE.md`·`AGENTS.md` 안에서 마커 주석 `<!-- guksu-harness:… start -->`와 `end` 사이. 도구가 이 구간만 다시 쓰고 바깥은 건드리지 않는다.
- 결정 상태: `confirmed`(팀이 답함) · `evidence`(저장소 근거로 확정) · `assumed`(추정, 팀이 바꿀 수 있음) · `pending`(미확인 — 안전한 기본값을 적용하고 표시).

흐름:

```
npx guksu-harness diagnose .              읽기만. 사실·추정·질문·충돌·검증 명령 후보
npx guksu-harness compose . --dry-run     명세 초안 + 변경 미리보기 (파일 안 바꿈)
npx guksu-harness compose . --set protection.allowCommitPush=false --set records.history=none
                                          결정 반영 → 명세 저장 → 설정·규칙·포인터·훅 생성 → 구조 검사
npx guksu-harness verify . [--run]        네 상태로 작동 확인. --run이면 검증 명령을 실제 실행
```

결정 키와 출처 판정:

| 키 | 값 | 저장소 근거로 확정하는 경우 | 묻는 경우 (기본값) |
|---|---|---|---|
| `apps` | claude·codex 목록 | `.claude/`·`CLAUDE.md`(claude), `.codex/`·`AGENTS.md`·`.agents/skills/`(codex), 설치 기록의 apps | 단서 없음 (claude) |
| `rules.guidance` | 지침 파일 목록 | 존재하는 `CLAUDE.md`·`AGENTS.md`·`CONTRIBUTING.md`·PR 템플릿·`docs/harness-rules.md` | 묻지 않음 |
| `rules.baseBranch` | 브랜치 이름 | `origin/HEAD` → 로컬 `main`·`master` | 후보가 여럿(예: main과 develop) |
| `rules.branchPrefixes` | 접두어 목록 | 지침 문서에 적힌 접두어(evidence) → 기존 브랜치 이름(assumed) → `feat/ fix/ refactor/ docs/`(assumed) | 묻지 않음 |
| `protection.protectedBranches` | 브랜치 목록 | 기존 `branchGuard.config.json` + 기본 브랜치 | 기본 브랜치가 기존 설정에 없거나(충돌), 장수 브랜치(develop·release·staging·production)가 더 있을 때 (기본 브랜치 포함 목록) |
| `protection.allowCommitPush` | true/false | 기존 `blockGitMutation.config.json`; 지침의 커밋·푸시 금지 문구(false) | 근거 없음 또는 지침과 설정이 충돌 (false. 충돌이면 기존 파일 값을 바꾸지 않고 표시만) |
| `protection.blockAttribution` | true/false | 기존 설정 | 커밋 허용일 때만 (false) |
| `verification.checks` | `{name, command}` 목록 | `package.json` scripts(test·lint·typecheck·build·check), CI 워크플로 `run:` 단계, Makefile 대상. 자리표시자(`no test specified`)와 CI가 부르는데 없는 스크립트는 제외 | 후보가 없음 (빈 목록) |
| `verification.gate` | rules / stop-hook | 기존 `verifierGate.config.json`이 있으면 stop-hook | 검증 명령이 있을 때 (rules) |
| `records.history` | none / optional / required | 기존 설정의 `requireHistoryDoc`(생략 시 암묵적 true 유지), 설치된 basic·collaboration 프로필(optional), 지침의 기록 의무 문구(required) | 근거 없음 (none). `docs/history/`에 기록이 있으면 optional을 기본으로 묻는다 |

명세에서 생성하는 것:

| 대상 | 내용 | 규칙 |
|---|---|---|
| `.agents/hooks/branchGuard.config.json` | `protectedBranches` | 기존 다른 키 보존. 실제 동작이 같으면 파일을 바꾸지 않는다 |
| `.agents/hooks/blockGitMutation.config.json` | `allowCommitPush`, `requireHistoryDoc`(records=required), `blockAttribution`(허용일 때), `historyBase`(기록 요구 시, 없을 때만) | 훅의 기본 해석과 같은 값이면 키를 추가하지 않는다 |
| `.agents/hooks/verifierGate.config.json` | `checks`, `maxIterations 10`, `stuckAfter 3` | gate=stop-hook일 때만. 기존 `maxTokens` 등 보존 |
| `docs/harness-rules.md` 생성 구간 | 네 영역의 정책·근거·미확인 표시를 사람이 읽는 문장으로 | 파일이 없으면 팀 규칙 양식 + 구간. 구간 밖은 팀 자리 |
| `CLAUDE.md`·`AGENTS.md` | `## 하네스` 절이 없으면 포인터 구간 추가 | 있으면 그대로. 없는 파일은 기존 포인터 양식으로 생성 |
| 번들 파일(훅·코어 규칙·등록·양식) | 기존 `createPlan`에 `app`·`profile`·`verifier`를 넘겨 함께 계획 | 프로필은 기존 설치 프로필을 유지하고, 팀이 기록을 선택했을 때만 basic으로 올린다 |

충돌과 멈춤:

- 팀이 생성 구간 안이나 생성한 설정 파일을 직접 고쳤다(기록된 해시와 다름) → 충돌. `--set`으로 명세를 맞추거나 `--force`로 다시 생성한다(백업 남김). 구간 밖 수정은 충돌이 아니다.
- 미리보기 이후 파일이 바뀌었다 → 적용 거부(기존 `applyPlan`과 같은 방식: 현재 상태에서 다시 계산해 비교).
- `verifierGate.config.json`이 있는데 명세가 rules다 → 충돌(게이트가 계속 동작하므로).
- 기존 `createPlan` 충돌(수정된 코어 파일 등) → 그대로 충돌.

## 4. 실행 방식과 역할

- 반복 가능한 조사·생성·병합·적용·검증은 코드(`skills/harness/scripts/teamCompose.mjs`)가 한다. 결정적이어야 미리보기와 적용이 일치한다.
- 근거 해석과 질문·설명은 대화 스킬(`harness`)이 한다. 스킬은 `diagnose --json`을 읽고, `pending` 항목만 영향과 함께 묻고, 답을 `compose --set`으로 넘긴다.
- 백업·복원·등록 병합·3-way 병합·export/import는 `harnessManager.mjs`를 그대로 쓴다. 백업 쓰기 함수만 공용으로 추출한다.

## 5. 안전장치와 권한

- 진단은 파일을 바꾸지 않고 민감정보 파일의 내용을 읽지 않는다. 경로 존재만 본다.
- 미확인 결정은 승인하지 않는다. 커밋·푸시 허용처럼 권한을 넓히는 항목의 기본값은 차단이다. 기존 파일이 허용으로 되어 있고 지침과 충돌하면 값을 바꾸지 않고 충돌로 보인다.
- 앱의 실행 승인과 저장소의 지속 정책은 다르다. 명세는 지속 정책만 다룬다.
- 검증 명령은 `verify --run`을 줄 때만 실행한다. 진단은 존재·자리표시자·의존성 설치 여부만 정적으로 판정한다.
- 훅 스크립트 시험은 임시 git 저장소와 가짜 명령으로 한다. 실제 앱 안의 실행은 항상 "확인 필요"로 남기고 절차를 준다.
- 적용은 한 번의 백업으로 묶는다. 쓰기 도중 실패하면 되돌리고, 나중에는 `rollback`으로 되돌린다.

## 6. 문답 기록

| 라운드 | 주제 | 결정 |
|--------|------|------|
| 1 | 제품 방향 | 사용자 지시: 진단→결정→명세→적용→확인 흐름의 첫 MVP. 기존 관리 코드 재사용, 재작성 금지. 커밋·푸시·배포 제외 |
| 구현 선택 | 명세 위치·형식 | `.agents/harness-team.json` 한 파일. 근거: 추적 기록과 같은 위치·형식이라 export/import·복원에 바로 얹힌다. 대화 없이 결정(가역적 구현 선택) |
| 구현 선택 | 미확인 결정 처리 | 차단·최소 기본값을 적용하고 명세와 규칙 문서에 미확인으로 표시. 적용을 막지 않는다. 근거: 사용자가 파일 구조를 몰라도 흐름이 끝나야 하고, 권한을 넓히는 기본값은 없다 |
| 구현 선택 | 훅 설정 생성 방식 | 파일 전체를 덮어쓰지 않고 관리 키만 맞춘다. 실제 동작이 같으면 키를 추가하지 않는다. 근거: 기존 설치본과 수동 설정을 보존하는 5.0.0의 원칙 |

## 7. 인수 시나리오

세 종류 예제 저장소를 임시 디렉터리에 만들고 아래 기대를 테스트로 고정한다.

### 시나리오 1 — 지침·하네스가 거의 없는 프로젝트

준비: git 저장소(`main`), `package.json`에 scripts 없음, 지침 파일·CI·훅 없음.

| 확인 | 기대 |
|---|---|
| 사실 | 기본 브랜치 main(로컬 브랜치), 지침 파일 없음, 검증 명령 없음, 하네스 미설치, 앱 단서 없음 |
| 추정 | 브랜치 접두어 기본값, 보호 브랜치 = main |
| 질문 | `apps`, `protection.allowCommitPush`, `records.history`, `verification.checks`(명령 없음). `verification.gate`는 묻지 않음(명령이 없어서) |
| 제안 | 훅 3종 + 코어 규칙 + 등록, `allowCommitPush false`, `protectedBranches [main]`, 팀 규칙 문서 생성 구간, 포인터 파일 생성 |
| 변경·보존 | 새 파일만 생성. 재적용 변경 0건. 명세에 pending 항목 기록 |
| 확인 | 설정 완료(파일·등록·설정=명세), 실행 확인(훅 스크립트 3종 임시 저장소 차단), 확인 필요(앱 실행 2종, 검증 명령 없음) |

### 시나리오 2 — 팀 규칙·CI·테스트 명령이 이미 있는 프로젝트

준비: `origin/HEAD → main`, 브랜치 `feat/login`·`fix/typo`, `CLAUDE.md`(팀 내용 + "브랜치는 feat/, fix/ 접두어", "AI는 커밋하지 않는다"), `CONTRIBUTING.md`, scripts `test`·`lint`·`build`, `.github/workflows/ci.yml`(`npm test`, `npm run lint`), `node_modules` 없음.

| 확인 | 기대 |
|---|---|
| 사실 | 기본 브랜치 main(origin/HEAD), 지침 2개, 접두어 feat/·fix/(문서 근거), 커밋 금지 문구, 검증 명령 3개(의존성 미설치), CI 명령 2개, 앱 claude |
| 질문 | `verification.gate`, `records.history`만. `allowCommitPush`·`apps`·접두어·보호 브랜치는 다시 묻지 않음 |
| 제안 | `allowCommitPush false`(근거: CLAUDE.md), checks = test·lint·build, gate rules(기본), 포인터 구간을 기존 CLAUDE.md 끝에 추가 |
| 변경·보존 | CLAUDE.md 기존 내용 그대로 + 구간 추가. `AGENTS.md` 생성 안 함. 재적용 0건. `--set verification.gate=stop-hook`이면 verifierGate 파일·등록·설정과 규칙 구간·명세만 바뀌고 branchGuard 설정은 그대로 |
| 확인 | `verify --run`: 실행 가능한 명령은 실행 확인, 의존성 없는 명령은 실패로 구분. 앱 실행은 확인 필요 |

### 시나리오 3 — 지침·설정이 충돌하고 검증 명령을 실행할 수 없는 프로젝트

준비: `main`, `CLAUDE.md`에 "AI는 커밋하지 않는다", 수동 설정 `blockGitMutation.config.json {allowCommitPush: true}`, `branchGuard.config.json {protectedBranches: ["master"]}`, `package.json` test가 npm 자리표시자, CI가 `npm run lint`를 부르는데 lint 스크립트 없음.

| 확인 | 기대 |
|---|---|
| 충돌 | (1) 커밋 금지 지침 vs 허용 설정, (2) 보호 브랜치에 기본 브랜치 main 없음, (3) CI가 부르는 lint 스크립트 없음 |
| 사실 | test 스크립트는 자리표시자(존재하나 실행 불가), 기록 정책은 기존 설정의 암묵적 기본값(required) |
| 질문 | `allowCommitPush`(충돌), `protectedBranches`(충돌 · 기본 main 추가), `verification.checks`(없음). `records.history`는 기존 암묵 정책이 있어 묻지 않음 |
| 변경·보존 | 답이 없으면 `blockGitMutation.config.json`은 바꾸지 않음(허용 유지, 충돌 표시). `branchGuard`는 main을 더한 목록을 제안. 자리표시자·없는 스크립트는 checks에서 제외 |
| 확인 | 훅 시험은 실제 설정(허용)에 맞춰 판정: 일반 커밋은 통과, force push는 차단. 검증 명령은 확인 필요(실행할 명령 없음) |

### 공통 — 흐름 전체와 실패 경로

- 진단 → `compose --dry-run`(파일 불변) → `compose`(적용·구조 검사 error 0) → `verify` → 재적용 0건.
- 생성 구간 안을 손으로 고치면 충돌로 멈추고, `--force`면 다시 생성하며 백업이 남는다.
- 설정 파일을 손으로 바꾸면 충돌. `--set`으로 명세를 같은 값으로 맞추면 해소된다.
- 미리보기 이후 파일이 바뀌면 적용을 거부한다.
- 적용 백업으로 `rollback`하면 적용 전 상태로 돌아간다(새 파일 삭제, 기존 파일 복원).

## 8. 미해결 질문

- 실제 앱 안의 훅 실행은 이 환경에서 확인할 수 없다. `verify`는 절차만 제공한다.
- 모델의 질문 품질(pending 항목만 묻는가, 영향을 설명하는가)은 코드 테스트로 검증할 수 없다. `docs/analysis/team-compose-evaluation.md`에 평가 시나리오를 두고 미실행으로 남긴다.
- 지침 문서의 정책 문구 판독은 규칙 기반(문구 패턴)이다. 놓친 정책은 질문으로, 잘못 읽은 정책은 근거 줄을 함께 보여 사용자가 바로잡는다.
- 가정: 팀 저장소는 Node 프로젝트가 가장 많다 — 검증 명령 추출은 package.json·CI·Makefile 중심이다. 다른 생태계는 파일 표지만으로 후보를 제안한다.
