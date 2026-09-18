# 상태 확인과 안전한 업데이트

`harnessManager.mjs`는 **이 번들에 포함된 공통 파일**을 프로젝트에 설치·업데이트한다. 도메인 스킬·에이전트·규칙 파일(CLAUDE.md·AGENTS.md) 작성은 `harness` 스킬이 담당한다. 기존 사용자 설정과 기록은 관리 대상에 포함하지 않는다.

관리 파일은 앱 중립 위치 `.agents/`에 둔다. 훅 등록만 앱별 파일에 쓴다.

| 파일 | 위치 |
|---|---|
| 훅 스크립트·설정 | `.agents/hooks/` |
| 설치 추적 기록 | `.agents/harness-install.json` |
| 백업 | `.agents/harness-backups/` |
| Claude Code 등록 | `.claude/settings.json` |
| Codex 등록 | `.codex/hooks.json` |

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

- 기본은 `basic`: 보호 훅 3종·규칙 파일·history/handoff 템플릿.
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
| unchanged | 이미 같음 |
| adopt | 추적되지 않았지만 번들과 내용이 같음. 적용하면 추적 시작 |
| conflict | 사용자 수정 또는 출처 불명. 덮어쓰지 않음 |
| preserve | 제거 작업에서도 문서를 보존하고 추적만 해제 |
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
