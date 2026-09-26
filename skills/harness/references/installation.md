# 상태 확인과 안전한 업데이트

일상 명령은 `npx guksu-harness`다. `init`(최초 설치)·`update`(갱신)·`status`·`check`(CI용 검사)·`eject`(코어 파일 소유 전환)·`export`/`import`(팀 묶음)를 제공하며 아래 관리자를 감싼다. `--dry-run`을 붙이면 미리보기만 한다. 저장소를 진단해 팀 결정만 묻고 설정·규칙을 함께 만드는 `diagnose`·`compose`·`verify`는 `team-compose.md`에 있다.

```bash
npx guksu-harness init /path/to/project --app both --ci
npx guksu-harness update /path/to/project
npx guksu-harness check /path/to/project
npx guksu-harness eject /path/to/project .agents/hooks/branchGuard.mjs --confirm
```

`harnessManager.mjs`는 **이 번들에 포함된 공통 파일**을 프로젝트에 설치·업데이트한다. 도메인 스킬·에이전트·규칙 파일(CLAUDE.md·AGENTS.md) 작성은 `harness` 스킬이 담당한다. 기존 사용자 설정과 기록은 관리 대상에 포함하지 않는다.

관리 파일은 앱 중립 위치 `.agents/`에 둔다. 훅 등록만 앱별 파일에 쓴다.

| 파일 | 위치 | 소유 |
|---|---|---|
| 훅 스크립트 | `.agents/hooks/` | 코어 — 미수정이면 교체, 수정본은 충돌. `eject` 가능 |
| 코어 규칙 사본 | `.agents/harness-core-rules.md` | 코어 — 미수정이면 교체, 수정본은 충돌 |
| 팀 규칙 | `docs/harness-rules.md` | 프로젝트 — 없을 때 한 번 생성, 이후 안 건드림 |
| 규칙 포인터 | `CLAUDE.md`·`AGENTS.md` | 프로젝트 — 없을 때 한 번 생성 |
| 문서 템플릿 | `docs/templates/` | 공동 — 미수정이면 교체, 팀 수정본은 설치 원본 사본과 3-way 병합. 같은 곳을 고쳤으면 충돌 |
| 병합 원본 사본 | `.agents/harness-base/docs/templates/` | 관리 도구 — 커밋한다(팀원 모두 같은 원본 기준) |
| CI 워크플로 | `.github/workflows/harness-check.yml` | 프로젝트 — `init --ci`·`update --ci`로 없을 때 한 번 생성 |
| 훅 설정값 | `.agents/hooks/*.config.json` | 프로젝트. `compose`는 명세의 관리 키만 맞춘다 |
| 팀 구성 명세 | `.agents/harness-team.json` | 프로젝트 — `compose`가 만든다. 커밋하고 팀 묶음에 포함 (`team-compose.md`) |
| 설치 추적 기록 | `.agents/harness-install.json` | 관리 도구 |
| 백업 | `.agents/harness-backups/` | 관리 도구 |
| Claude Code 등록 | `.claude/settings.json` | 공동 — 이 도구가 넣은 항목만 갱신 |
| Codex 등록 | `.codex/hooks.json` | 공동 |

필요 환경: Node.js 22 이상. 아래 명령의 `MANAGER`는 설치된 플러그인의 `skills/harness/scripts/harnessManager.mjs` 절대 경로다. 플러그인 저장소에서 실행할 때는 이 상대 경로를 그대로 사용할 수 있다.

## 상태만 확인

```bash
node "$MANAGER" status /path/to/project
node "$MANAGER" status /path/to/project --json
```

번들 버전, 설치 추적 버전, 대상 앱, 현재 브랜치, 훅 파일·앱별 등록·설정 여부와 구조 문제를 표시한다. 추적 기록이 없는 수동 설치는 설치 버전을 추측하지 않는다. 등록 검사는 `.claude/settings.json`·`.codex/hooks.json` 기준이다. 앱별 개인 설정·플러그인 로딩 상태나 실제 실행 여부까지 검증하지 않는다. v2 위치(`.claude/hooks/`, `.claude/harness-install.json`)에 남은 파일은 이동 대상으로 경고한다.

## 미리보기 → 적용

```bash
node "$MANAGER" plan /path/to/project --out /tmp/harness-plan.json
node "$MANAGER" apply /path/to/project --plan /tmp/harness-plan.json
```

- 새 설치 기본은 `minimal`: 보호 훅 3종·규칙 파일. `basic`을 선택하면 history/handoff 양식을 추가한다.
- `--app claude|codex|both`: 훅을 등록할 앱. 생략하면 프로젝트의 `.claude/`·`CLAUDE.md`(claude), `.codex/`·`AGENTS.md`·`.agents/skills/`(codex) 유무로 추정하고 둘 다 없으면 claude다. 한 번 적용하면 추적 기록의 값을 재사용한다. codex 등록에는 Read deny가 없다(Claude Code 전용 권한).
- `--profile collaboration`: retro/loop-spec 템플릿 추가. 에이전트는 자동 생성하지 않는다.
- `--verifier`: 종료 검사 훅 파일·Stop 등록 추가. 검사 명령 config는 자동 생성하지 않는다. `loop` 스킬의 예시를 프로젝트 검증 명령에 맞게 구성해야 활성화된다.
- `--only .agents/hooks/branchGuard.mjs,docs/templates/history.md`: 선택한 번들 파일만 대상으로 계획한다. 필요한 훅 등록·공통 deny 병합과 추적 기록도 함께 표시한다.
- `--json`: 파일별 상태와 적용 내용을 JSON으로 표시한다.
- `--out`은 기존 파일을 덮어쓰지 않는다. 다시 계획할 때는 새 파일명을 사용한다.

미리보기는 프로젝트 파일을 바꾸지 않는다. 사용자가 이미 업데이트를 요청했다면 결과를 설명하고 적용할 수 있다. 충돌 때문에 새로운 결정이 필요한 경우만 질문한다.

## 파일별 처리

| 상태 | 의미 |
|---|---|
| create | 대상 파일이 없어 새로 생성 |
| update | 마지막 설치본 그대로인 파일을 새 번들로 교체하거나 관리 설정을 병합 |
| merge | 팀이 고친 템플릿에 새 버전의 변경을 3-way 병합해 적용 |
| unchanged | 이미 같음 |
| adopt | 추적되지 않았지만 번들과 내용이 같음. 적용하면 추적 시작 |
| conflict | 사용자 수정 또는 출처 불명. 덮어쓰지 않음 |
| preserve | 제거 작업에서 문서를 보존하고 추적만 해제. 업데이트에서는 병합 원본 사본이 없는 팀 수정 템플릿을 그대로 두고 사본을 등록 |
| delete | 추적한 훅 파일을 제거. v2 위치의 파일·설정·추적 기록을 새 위치로 옮길 때도 이전 파일에 표시된다 |

충돌이 하나라도 있으면 전체 적용을 멈춘다. 안전한 항목부터 진행하려면 `--only`로 새 계획을 만든다. 업데이트 전에 수정된 규칙·템플릿은 직접 비교해 합칠 수 있지만 자동 덮어쓰기는 제공하지 않는다.

계획 생성 이후 대상 파일·번들 버전·설정이 달라졌으면 적용을 거부한다. 저장된 계획을 현재 파일에서 다시 계산해 비교하므로 오래된 미리보기나 임의 수정한 계획을 실행하지 않는다.

## 추적과 백업

- `.agents/harness-install.json`: 파일별 설치 해시·버전·대상 앱·이 도구가 추가한 등록 항목(앱별). 공유·커밋 대상이다. 일부 파일만 업데이트했다면 파일별 버전을 확인한다. 상단 버전은 마지막 관리 실행의 번들 버전이다.
- `.agents/harness-backups/{id}.json`: 적용 전 파일 내용. 로컬 복원용이며 커밋하지 않는다.
- 프로필을 기본으로 낮춰도 기존 협업 파일을 자동 삭제하지 않는다. 제거할 파일은 별도 계획에서 선택한다.

프로젝트 `.gitignore`에 다음을 등록한다(관리자는 `.gitignore`를 직접 수정하지 않는다):

```gitignore
_workspace/
.agents/harness-backups/
.agents/hooks/verifierGate.*.state.json
.agents/hooks/verifierGate.*.tmp
```

복원은 적용 결과에 나온 상대 백업 경로를 사용한다:

```bash
node "$MANAGER" rollback /path/to/project --backup .agents/harness-backups/{id}.json
```

적용 후 사용자가 바꾼 파일이 있으면 전체 복원을 거부한다. 복원은 파일 내용 기준이며 빈 디렉토리와 로컬 백업은 남는다. 업데이트 중 쓰기 오류가 발생하면 이미 적용한 파일을 이전 내용으로 복원한다. 여러 관리 명령을 같은 프로젝트에서 동시에 실행하지 않는다.

## 제거

```bash
node "$MANAGER" plan /path/to/project --mode remove --out /tmp/harness-remove.json
node "$MANAGER" apply /path/to/project --plan /tmp/harness-remove.json
```

추적한 훅과 이 도구가 추가한 정확한 등록 항목만 제거한다. 수정된 등록이나 기존 수동 등록이 파일을 참조하면 충돌로 남긴다. 설정 파일·문서·사용자 작업 기록은 보존한다. 도메인 정의나 CLAUDE.md 참조는 `harness` 스킬에서 먼저 정리한다. 추적 기록이 없는 옛 설치본을 임의로 삭제하지 않는다.

## 문서 템플릿 3-way 병합

추적 중인 템플릿(`docs/templates/*.md` — basic·collaboration으로 설치했거나 import로 가져온 양식)은 팀이 고칠 수 있고 코어 업데이트도 받는 공동 파일이다. minimal에서 직접 복사한 양식은 추적하지 않으므로 업데이트가 건드리지 않는다. 설치·업데이트 때 원본 사본을 `.agents/harness-base/docs/templates/`에 둔다. 업데이트 때 파일 상태에 따라 이렇게 처리한다.

| 팀 수정 | 사본 | 처리 |
|---|---|---|
| 없음 | — | 새 버전으로 교체 |
| 있음 | 있음 | 사본·팀 수정본·새 버전을 `git merge-file`로 병합(merge). 같은 곳을 고쳤으면 conflict — 직접 병합 후 다시 실행 |
| 있음 | 없음(v4.0 이하 설치본) | 수정본을 그대로 두고(preserve) 현재 번들 원본을 사본으로 등록. 다음 업데이트부터 병합 |

병합 결과를 추적 해시로 기록하므로 재적용은 변경 0건이다. `status`의 파일 상태 `customized`는 팀 수정이 반영된 추적본이라는 뜻이다. git이 없으면 병합하지 못하고 충돌로 표시한다. 사본 디렉터리는 커밋한다 — 팀원마다 사본이 다르면 병합 결과도 달라진다.

## CI 검사 워크플로 (--ci)

`init --ci` 또는 `update --ci`가 `.github/workflows/harness-check.yml`을 만든다. PR과 main 푸시마다 `npx --yes guksu-harness@5 check .`를 실행해 error가 있으면 실패한다. 프로젝트 파일이라 한 번 만든 뒤에는 팀이 트리거·노드 버전을 자유롭게 고친다. `update`는 이 파일을 바꾸지 않으므로 주 버전이 오르면 `@` 뒤 숫자를 직접 바꾼다. npm에 패키지가 배포되어 있어야 동작한다.

## 팀 묶음 — export / import

```bash
npx guksu-harness export /path/to/source --out team-preset.json
npx guksu-harness import /path/to/target --from team-preset.json [--force]
```

`export`는 팀이 소유하거나 고친 파일만 한 JSON에 담는다. `import`는 설치된 프로젝트에 그 파일들을 쓴다.

| 종류 | 경로 | 담는 조건 |
|---|---|---|
| 팀 규칙 | `docs/harness-rules.md` | 있으면 |
| 훅 설정값 | `.agents/hooks/*.config.json` | 있으면 |
| 팀 훅 | `.agents/hooks/*.mjs` (코어 이름 제외) | 있으면 |
| 팀 스킬 | `.claude/skills/**`, `.agents/skills/**` (SKILL.md·scripts·references·assets) | 있으면 |
| 문서 템플릿 | `docs/templates/*.md` | 팀이 고친 것만(사본·번들과 다를 때) |
| CI 워크플로 | `.github/workflows/harness-check.yml` | 있으면 |

담지 않는 것: 코어 훅·코어 규칙 사본(각 저장소의 `update`가 준다), 규칙 포인터 `CLAUDE.md`·`AGENTS.md`(프로젝트 고유), 추적 기록·백업·사본, 작업 기록, 훅 상태 파일.

`import` 규칙: 위 종류의 경로만 쓴다(코어 훅 이름·프로젝트 밖 경로·그 밖의 경로는 거부). 이미 있고 내용이 다른 파일은 `--force` 없이는 건너뛴다. 단 `init`이 만든 뒤 손대지 않은 파일(원본 사본이나 초기 양식과 같은 템플릿·팀 규칙·CI 워크플로, 새 minimal 설치가 만든 초기값 그대로인 Git 설정)은 잃을 것이 없으므로 그냥 쓴다. 쓴 파일은 백업에 남아 `rollback`으로 되돌릴 수 있다. 가져온 템플릿은 다음 `update`에서 병합 대상이 된다. 팀 훅의 앱 등록은 묶음에 없으므로 직접 추가한다. 묶음 파일은 커밋해 두면 새 저장소를 `init` + `import`로 만들 수 있다. 묶음은 프로필을 옮기지 않는다. 기준 저장소가 basic·collaboration이면 `init`에 같은 `--profile`을 준다. 훅 설정값에 비밀이 없는지 확인한 뒤 공유한다.

## eject — 코어 파일을 프로젝트 소유로

```bash
npx guksu-harness eject /path/to/project .agents/hooks/branchGuard.mjs --confirm
```

대상 파일의 추적을 해제하고 `harness-install.json`의 `ejected`에 기록한다. 파일은 그대로 남고 이후 업데이트·제거에서 건드리지 않는다. 코어 파일(훅 4종·코어 규칙 사본)에만 쓸 수 있다. 되돌리려면 파일을 지우고 `ejected` 항목을 제거한 뒤 `update`를 실행한다. 팀이 코어 파일을 고쳐야 할 때의 탈출구이며 기본 안내는 하지 않는다 — 대부분의 커스텀은 설정값·팀 규칙·팀 스킬·팀 훅으로 해결한다.

## v3 규칙 파일 전환 (v4.0.0)

v3.x는 `docs/harness-rules.md`에 코어 규칙 전문을 두고 추적했다. v4는 코어 사본을 `.agents/harness-core-rules.md`로 옮기고 `docs/harness-rules.md`를 팀 규칙 파일로 쓴다.

| 대상 | 계획에 표시되는 처리 |
|---|---|
| `docs/harness-rules.md` (v3 원본 그대로) | update — 팀 규칙 양식(코어 포인터 + 빈 팀 규칙)으로 교체. 추적 해제 |
| `docs/harness-rules.md` (팀이 수정) | preserve — 그대로 두고 추적만 해제. `status`가 "코어 규칙 전문이 남아 있다"고 안내하므로 코어 규칙 7개를 지우고 포인터를 남긴다 |
| `.agents/harness-core-rules.md` | create |

## v2 설치본 이동 (v3.0.0)

v2.x는 훅을 `.claude/hooks/`, 추적 기록을 `.claude/harness-install.json`에 두었다. v3 관리자는 v2 추적 기록을 읽고 업데이트 계획에 이동을 포함한다.

| 대상 | 계획에 표시되는 처리 |
|---|---|
| `.claude/hooks/{name}.mjs` (설치본 그대로) | delete + `.agents/hooks/{name}.mjs` create |
| `.claude/hooks/{name}.mjs` (사용자 수정) | conflict. 옮기지 않고 새 파일도 만들지 않는다 |
| `.claude/hooks/{name}.config.json` | 새 위치에 없으면 create + 이전 파일 delete. 새 위치에 다른 내용이 있으면 conflict |
| `.claude/settings.json`의 이 도구가 추가한 등록 | 새 경로 등록으로 교체. 수동 등록은 그대로 두고, 그 등록이 이전 파일을 참조하면 파일 이동을 conflict로 멈춘다 |
| `.claude/harness-install.json` | `.agents/harness-install.json`으로 이동 |

빈 `.claude/hooks/` 디렉터리는 남을 수 있다. 이동 후 `.gitignore`의 백업·상태 파일 경로를 `.agents/`로 바꾼다. 이동 전 상태는 백업으로 복원할 수 있다.

## 변경된 기본 정책

v2.3.0부터 Claude 작성자 표기 제한은 `blockAttribution: true`를 설정한 경우에만 적용된다. 이전 정책을 유지하려는 프로젝트는 훅 업데이트와 함께 해당 설정을 추가한다. 커밋 허용(`allowCommitPush`)과 기록 요구(`requireHistoryDoc`)는 기존 설정을 그대로 따른다. 관리자는 이 권한 설정을 자동 변경하지 않는다.

## 최소 구성으로 전환

새 설치는 minimal이며 기록 양식을 만들지 않는다. basic은 history·handoff, collaboration은 retro·loop-spec까지 설치한다. 기존 설치의 프로필은 유지하며 프로필 없는 추적 기록은 basic으로 처리한다.

`npx guksu-harness update . --profile minimal`은 앞으로의 기본 선택을 바꾼다. 이미 추적한 양식은 계속 병합·갱신하고 삭제하지 않는다. 양식 관리까지 중단하려면 관리자 `plan --mode remove --only docs/templates/history.md,docs/templates/handoff.md`로 문서는 보존하고 추적과 병합 원본만 제거할 수 있다. minimal에서는 다음 update가 그 양식을 재설치하지 않는다.

새 minimal 설치는 Git 설정이 없고 기존·수동 Git 훅도 없을 때만 `allowCommitPush: false`, `requireHistoryDoc: false` 설정을 생성한다. 기존 설정은 수정하지 않는다. 과거 설정의 기록 요구 생략값(true)도 보존한다. 기존 규칙 포인터의 기록 지침은 팀 소유이므로 별도 검토한다.

`--ci`는 구조 검사만 추가한다. 제품 테스트나 실제 앱에서 훅이 실행되는지는 별도로 검증한다.
