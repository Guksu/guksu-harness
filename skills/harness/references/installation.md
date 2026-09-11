# 상태 확인과 안전한 업데이트

`harnessManager.mjs`는 **이 번들에 포함된 공통 파일**을 프로젝트에 설치·업데이트한다. 도메인 스킬·에이전트·CLAUDE.md 작성은 `harness` 스킬이 담당한다. 기존 사용자 설정과 기록은 관리 대상에 포함하지 않는다.

필요 환경: Node.js 22 이상. 아래 명령의 `MANAGER`는 설치된 플러그인의 `skills/harness/scripts/harnessManager.mjs` 절대 경로다. 플러그인 저장소에서 실행할 때는 이 상대 경로를 그대로 사용할 수 있다.

## 상태만 확인

```bash
node "$MANAGER" status /path/to/project
node "$MANAGER" status /path/to/project --json
```

번들 버전, 설치 추적 버전, 현재 브랜치, 훅 파일·등록·설정 여부와 구조 문제를 표시한다. 추적 기록이 없는 수동 설치는 설치 버전을 추측하지 않는다. 등록 검사는 공유 `.claude/settings.json` 기준이다. 앱별 개인 설정·플러그인 로딩 상태나 실제 실행 여부까지 검증하지 않는다.

## 미리보기 → 적용

```bash
node "$MANAGER" plan /path/to/project --out /tmp/harness-plan.json
node "$MANAGER" apply /path/to/project --plan /tmp/harness-plan.json
```

- 기본은 `basic`: 보호 훅 3종·규칙 파일·history/handoff 템플릿.
- `--profile collaboration`: retro/loop-spec 템플릿 추가. 에이전트는 자동 생성하지 않는다.
- `--verifier`: 종료 검사 훅 파일·Stop 등록 추가. 검사 명령 config는 자동 생성하지 않는다. `loop` 스킬의 예시를 프로젝트 검증 명령에 맞게 구성해야 활성화된다.
- `--only .claude/hooks/branchGuard.mjs,docs/templates/history.md`: 선택한 번들 파일만 대상으로 계획한다. 필요한 훅 등록·공통 deny 병합과 추적 기록도 함께 표시한다.
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
| delete | 추적한 훅 파일을 제거 |

충돌이 하나라도 있으면 전체 적용을 멈춘다. 안전한 항목부터 진행하려면 `--only`로 새 계획을 만든다. 업데이트 전에 수정된 규칙·템플릿은 직접 비교해 합칠 수 있지만 자동 덮어쓰기는 제공하지 않는다.

계획 생성 이후 대상 파일·번들 버전·설정이 달라졌으면 적용을 거부한다. 저장된 계획을 현재 파일에서 다시 계산해 비교하므로 오래된 미리보기나 임의 수정한 계획을 실행하지 않는다.

## 추적과 백업

- `.claude/harness-install.json`: 파일별 설치 해시·버전·이 도구가 추가한 등록 항목. 공유·커밋 대상이다. 일부 파일만 업데이트했다면 파일별 버전을 확인한다. 상단 버전은 마지막 관리 실행의 번들 버전이다.
- `.claude/harness-backups/{id}.json`: 적용 전 파일 내용. 로컬 복원용이며 커밋하지 않는다.
- 프로필을 기본으로 낮춰도 기존 협업 파일을 자동 삭제하지 않는다. 제거할 파일은 별도 계획에서 선택한다.

프로젝트 `.gitignore`에 다음을 등록한다(관리자는 `.gitignore`를 직접 수정하지 않는다):

```gitignore
_workspace/
.claude/harness-backups/
.claude/hooks/verifierGate.*.state.json
.claude/hooks/verifierGate.*.tmp
```

복원은 적용 결과에 나온 상대 백업 경로를 사용한다:

```bash
node "$MANAGER" rollback /path/to/project --backup .claude/harness-backups/{id}.json
```

적용 후 사용자가 바꾼 파일이 있으면 전체 복원을 거부한다. 복원은 파일 내용 기준이며 빈 디렉토리와 로컬 백업은 남는다. 업데이트 중 쓰기 오류가 발생하면 이미 적용한 파일을 이전 내용으로 복원한다. 여러 관리 명령을 같은 프로젝트에서 동시에 실행하지 않는다.

## 제거

```bash
node "$MANAGER" plan /path/to/project --mode remove --out /tmp/harness-remove.json
node "$MANAGER" apply /path/to/project --plan /tmp/harness-remove.json
```

추적한 훅과 이 도구가 추가한 정확한 등록 항목만 제거한다. 수정된 등록이나 기존 수동 등록이 파일을 참조하면 충돌로 남긴다. 설정 파일·문서·사용자 작업 기록은 보존한다. 도메인 정의나 CLAUDE.md 참조는 `harness` 스킬에서 먼저 정리한다. 추적 기록이 없는 옛 설치본을 임의로 삭제하지 않는다.

## 변경된 기본 정책

v2.3.0부터 Claude 작성자 표기 제한은 `blockAttribution: true`를 설정한 경우에만 적용된다. 이전 정책을 유지하려는 프로젝트는 훅 업데이트와 함께 해당 설정을 추가한다. 커밋 허용(`allowCommitPush`)과 기록 요구(`requireHistoryDoc`)는 기존 설정을 그대로 따른다. 관리자는 이 권한 설정을 자동 변경하지 않는다.
