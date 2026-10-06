# 보호 장치와 프로젝트 설정

훅은 앱(Claude Code·Codex)의 도구 실행·종료 이벤트에 연결되는 스크립트다. 등록된 경로에서 실수를 줄이지만 모든 셸 우회나 다른 앱까지 막는 보안 경계는 아니다. 사용자 승인 여부는 스킬이 대화에서 판단한다.

훅 스크립트와 설정 파일은 앱 중립 위치 `.agents/hooks/`에 한 벌만 둔다. 등록만 앱별 파일에 쓴다.

| 앱 | 등록 파일 | 등록 내용 |
|---|---|---|
| Claude Code | `.claude/settings.json` | `hooks` + `permissions.deny` |
| Codex | `.codex/hooks.json` | `hooks` |

## 1. 설치와 기존 설정 보존

`npx guksu-harness init`(최초) 또는 `update`(갱신)로 설치한다. 세밀한 미리보기는 `harnessManager.mjs plan`·`apply` → `installation.md`. `--app claude|codex|both`로 등록할 앱을 고른다. 생략하면 프로젝트의 `.claude/`·`CLAUDE.md`·`.codex/`·`AGENTS.md` 유무로 추정하고, 한 번 적용한 뒤에는 추적 기록의 값을 쓴다.

기본 훅 3종은 `.agents/hooks/`에 복사한다. 앱별 등록 형태:

Claude Code (`.claude/settings.json`, `PreToolUse`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.agents/hooks/blockGitMutation.mjs\"" },
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.agents/hooks/blockSecretAccess.mjs\"" }
        ]
      },
      {
        "matcher": "Edit|Write|NotebookEdit",
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.agents/hooks/branchGuard.mjs\"" }]
      }
    ]
  }
}
```

Codex (`.codex/hooks.json`, `PreToolUse`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node \"$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.agents/hooks/blockGitMutation.mjs\"" },
          { "type": "command", "command": "node \"$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.agents/hooks/blockSecretAccess.mjs\"" }
        ]
      },
      {
        "matcher": "apply_patch|Edit|Write",
        "hooks": [{ "type": "command", "command": "node \"$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.agents/hooks/branchGuard.mjs\"" }]
      }
    ]
  }
}
```

두 형식의 차이는 세 가지다. Codex에는 `CLAUDE_PROJECT_DIR` 환경변수가 없어 Git 루트를 찾는 셸 명령을 쓴다. 하위 패키지·worktree에서도 루트의 훅을 실행한다. Git이 없는 프로젝트는 루트에서 실행해야 한다. Codex는 파일 편집 도구를 `apply_patch`로 보고하므로 matcher가 다르다. `permissions.deny`는 Claude Code 전용 권한이다.

관리자는 같은 의미의 훅을 개별 등록 항목으로 추가한다. 수동 등록이나 다른 도구의 항목을 덮어쓰지 않는다. 개인 설정(`~/.claude`, `~/.codex`)은 자동 수정하지 않는다.

## 2. git 명령 보호

`blockGitMutation.mjs`는 기본적으로 commit·push 등 변경 명령을 차단한다. 읽기 명령과 일반 `git switch`·스테이징은 허용한다. switch의 강제·변경 폐기·detached HEAD 옵션과 merge·rebase·reset·원격 삭제 등은 계속 차단한다.

`.agents/hooks/blockGitMutation.config.json`:

```json
{
  "allowCommitPush": true,
  "requireHistoryDoc": true,
  "historyBase": "origin/main",
  "historyCommitTypes": ["fix", "hotfix", "feat", "policy"],
  "blockAttribution": false
}
```

| 설정 | 동작 |
|---|---|
| allowCommitPush | 기본 false. 영구 허용은 사용자가 요청한 경우에만 설정 |
| requireHistoryDoc | commit·push 허용 시 기존 설정에서 생략 시 true, 새 minimal 설치는 false를 명시. push할 변경에 `docs/history/*.md`를 요구 |
| historyBase | 생략 시 dev·main·master 계열을 탐색. 프로젝트 기준 브랜치를 지정하는 편이 명확함 |
| historyCommitTypes | 기록을 요구할 커밋 타입. 생략 시 `fix`·`hotfix`·`feat`·`policy`. `["*"]`는 모든 push에 요구(5.1.0 이하 동작). 문자열 배열이 아니면 모든 push에 요구 |
| blockAttribution | 기본 false. true이면 Claude 작성자 표기 패턴을 차단 |

기록 게이트는 base 이후 커밋(병합 제외)의 제목을 Conventional Commits로 읽는다. 대상 타입, 호환성 변경(`타입!` 또는 `BREAKING CHANGE:` 꼬리말), 형식을 읽을 수 없는 커밋 중 하나라도 있으면 `docs/history/`의 기록 문서를 요구한다. 색인 `docs/history/README.md`만 바꾼 것은 기록으로 치지 않는다. 대상 커밋이 없으면 기록 없이도 push한다.

설정 파일이 없거나 파싱에 실패하면 커밋·푸시 예외는 비활성이다. 기록 기준을 찾지 못하면 기록 게이트는 통과하므로 승인·보안 장치로 사용하지 않는다. 기록 게이트의 git 명령은 훅 입력의 `cwd`에서 실행한다. 기존 표기 제한을 유지하려면 업데이트 전에 `blockAttribution: true`를 설정한다.

허용 상태에서도 force/delete push와 amend/fixup/squash는 차단한다. 간접 커밋 메시지 옵션(`-F`, `-t`, `-c`, `-C`)은 `blockAttribution: true`일 때만 차단한다. worktree 조회와 일반 생성은 허용하고 강제 생성·삭제·이동·정리는 차단한다. 이 검사는 셸 파서 전체를 대체하지 않는다.

## 3. 보호 브랜치

`branchGuard.mjs`는 파일 편집 도구(Claude Code: Edit·Write·NotebookEdit, Codex: apply_patch)에서 보호 브랜치 편집을 차단한다.

```json
{ "protectedBranches": ["main", "master"] }
```

설정 파일은 `.agents/hooks/branchGuard.config.json`이다. 없으면 main·master를 사용하며 JSON 파싱 오류와 잘못된 배열 형식은 편집을 차단한다. 빈 배열은 보호 브랜치가 없다는 명시적 설정이다. 브랜치 이름은 정확히 일치해야 하며 와일드카드를 지원하지 않는다. 프로젝트 경로는 훅 입력의 `cwd`를 먼저 쓰고, 없으면 `CLAUDE_PROJECT_DIR`, 현재 디렉터리 순으로 찾는다. 시작 경로에서 부모를 따라 가장 가까운 `.git`을 찾는다. git 저장소가 아니거나 detached HEAD·브랜치 조회 실패면 비활성이다. Bash로 파일을 쓰는 경로는 검사하지 않으므로 작업 시작 시 브랜치 확인을 병행한다.

## 4. 민감정보 접근

`blockSecretAccess.mjs`는 알려진 민감정보 경로의 Bash 접근을 검사한다. Claude Code의 Read 도구는 공유 설정의 deny를 함께 구성한다:

```json
{
  "permissions": {
    "deny": ["Read(./.env)", "Read(./.env.*)", "Read(./**/credentials*)", "Read(./**/*.pem)", "Read(./**/secrets/**)"]
  }
}
```

프로젝트의 실제 경로가 다르면 패턴도 조정한다. 실제 키 값을 조사하거나 출력하지 않는다. Bash 훅과 Read deny의 적용 경로는 다르며, 예시 파일의 예외도 각 도구 설정에서 확인한다. Codex에는 이 deny에 해당하는 설정을 확인하지 못했다. Codex에서는 Bash 훅과 코어 규칙(`.agents/harness-core-rules.md`)의 민감정보 항목만 적용된다.

## 5. 종료 검사 (선택)

`verifierGate.mjs`를 Stop에 등록한다. `init --verifier`(또는 관리자의 `plan --verifier`)로 파일·등록을 추가하고, 훅 옆 `.agents/hooks/verifierGate.config.json`에 검사 명령을 쓴다.

```json
{
  "checks": [{ "name": "test", "command": "npm test" }],
  "maxIterations": 10,
  "stuckAfter": 3
}
```

- 설정이 없으면 비활성. checks는 이름과 명령이 있는 비어 있지 않은 배열이다.
- 통과하면 종료한다. 실패 후 이어진 Stop도 재검사한다.
- 최대 차단 횟수(기본 10)·같은 실패 횟수에 도달하면 중단 보고를 한 번 요청하고 다음 종료를 허용한다. `stop_hook_active`만으로 검사를 생략하지 않는다.
- 상태는 세션별 파일에 기록한다. 다른 세션의 횟수를 공유하지 않는다. 동일 세션의 Stop 이벤트는 순서대로 처리해야 한다.
- `maxTokens`는 선택이며 transcript 입력·출력·캐시 생성의 누적 근사치다. 과금액이나 실시간 상한이 아니다. 설정했지만 transcript를 읽지 못하면 사유를 보고하고 중단한다. 지원하는 형식은 JSONL의 `message.usage`다. 알 수 없는 형식·빈 파일·손상된 레코드·잘못된 수치는 미측정이며 0이 아니다. 이때도 maxTokens가 있으면 사유를 보고하고 중단한다. Codex transcript의 사용량 어댑터는 아직 지원하지 않으므로 Codex에서는 maxTokens를 설정하지 않고 `maxIterations`·`stuckAfter`를 사용한다.
- 설정 오류는 검사 성공으로 처리하지 않는다. 오류 보고 후 종료한다.
- 각 검사는 상대 `cwd`·`workspace`·`timeoutMs`·`required`를 지원한다. 생략하면 루트·최대 5분·필수 검사다. 설치된 Stop 훅은 세션 cwd와 무관하게 하네스 루트를 기준으로 실행한다. 상세는 `monorepo.md`를 참고한다.
- 실패 시그니처는 cwd·종료 코드·실패 출력 전체의 해시로 구분한다. 줄 번호·소요 시간 변동을 정규화하지만 테스트 이름의 숫자는 보존한다. 보고할 출력은 앞 500자·뒤 1500자로 제한한다.
- 건당 검사 명령은 최대 5분이다. 한 번의 명령 실행 도중 예산 초과를 감지해 취소하지 않으며 강제 앱 종료까지 막지는 않는다.

Stop 훅을 새로 등록하는 것과 한 작업에서 테스트를 재시도하는 것은 다르다. 일반적인 개발 재시도에는 이 설정을 요구하지 않는다.

## 6. 사전 허용과 확인

자주 실행하는 테스트·타입체크는 프로젝트에서 부수효과를 확인한 뒤 allowlist로 허용할 수 있다. 배포·패키지 발행·실제 결제 등 외부 영향이 있는 작업은 일괄 허용하지 않는다. 이미 받은 승인은 유지하되 단발 요청을 영구 권한 확대로 바꾸지 않는다.

## 7. 제거

관리 도구는 자신이 추가한 정확한 훅·deny 항목만 해제한다. 사용자가 수정한 등록이나 파일은 충돌로 보존한다. 수동 설치의 출처가 불명확하면 목록을 보고하고 삭제를 추측하지 않는다. 문서·사용자 기록은 보존한다.

## 8. 앱별 실행 조건과 확인 방법

등록 파일에 항목이 있어도 앱이 훅을 실행하지 않으면 보호는 없다. 상태 진단(`status`)은 등록 여부만 본다. `npx guksu-harness verify`는 설치된 훅 스크립트를 임시 저장소와 가짜 명령으로 실행해 보지만, 그것은 스크립트 시험이며 앱 통합의 증거가 아니다. 아래는 앱별로 사용자가 확인할 것이다.

| 항목 | Claude Code | Codex |
|---|---|---|
| 훅 기능 | 기본 활성 | 현재 공식 문서는 기본 활성으로 설명한다. 앱 버전·사용자·관리 설정에 따라 비활성일 수 있다 |
| 프로젝트 등록 파일 신뢰 | 프로젝트 공유 설정을 로드하며, 대화형 실행에서는 작업 폴더 신뢰를 확인한다 | 프로젝트 신뢰와 **훅 정의별 신뢰**가 필요하다. `/hooks`에서 검토한다. 훅 정의가 바뀌면 다시 검토할 수 있다 |
| 훅 프로세스의 현재 디렉터리 | 프로젝트 컨텍스트 사용 | 세션 cwd를 사용한다. 하네스 등록 명령은 Git 루트에서 스크립트를 찾는다 |
| 편집 차단 | 사용 중인 버전에서 확인 | `apply_patch` 지원 여부와 실제 차단을 사용 중인 버전에서 확인 |
| Read deny | 동작 | 해당 없음 |

Codex는 먼저 `npx guksu-harness verify <실제 실행 디렉터리> --runtime`으로 프로젝트 계층과 훅의 발견·활성·신뢰 상태를 조회할 수 있다. 프로젝트 계층 비활성과 `/hooks`의 신뢰 검토 대기를 구분하며, 준비 상태를 확인하지 못하면 종료 코드 1이다. 이 선택 조회는 모델·훅을 실행하거나 신뢰를 변경하지 않고 실제 차단 검증도 대신하지 않는다. Codex 계측 시험은 같은 사전 진단을 거쳐 준비되지 않으면 모델 호출 전에 멈춘다.

실제 프로젝트의 비밀이나 커밋으로 시험하지 않는다. [계측 시험 절차](hook-probe.md)는 가짜 `.env`와 독립된 임시 저장소를 만든다. 기존 환경에서 수동 확인한다면 아래도 임시 저장소에서만 시도한다:

1. `main` 브랜치에서 파일 편집을 요청한다. 차단 메시지("보호 브랜치")가 나오면 branchGuard가 동작한다.
2. `git commit -m test`를 요청한다. 차단 메시지("git 변경 작업은 사용자 전담")가 나오면 blockGitMutation이 동작한다.
3. `cat .env`를 요청한다. 차단 메시지("시크릿 파일")가 나오면 blockSecretAccess가 동작한다.

호출 자체가 없거나 다른 권한 정책이 먼저 차단했다면 해당 훅은 미확인이다. 훅의 종료 코드 2와 실제 도구 실행 여부를 함께 확인한다. 실패한 항목을 보고하고 팀에서 기록을 요구할 때 해당 문서에 남긴다.

참고: [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Claude Code hooks](https://code.claude.com/docs/en/hooks). CLI 시험 결과를 GUI 앱의 검증으로 대신하지 않는다.

2026-10-05 로컬 시험에서 Claude Code 2.1.283은 루트 실행 시 세 가드의 차단이 관찰됐지만 하위 폴더 실행에서는 이벤트가 없었다. 10월 6일 `--init-only` 대조 시험도 루트에서만 SessionStart를 기록했다. [공식 설정 문서](https://code.claude.com/docs/en/settings)는 공유 `.claude/settings.json`을 주 작업 디렉터리에서 읽으며 상위 `CLAUDE.md`와 다르게 취급한다. 모노레포에서도 앱은 하네스를 설치한 루트에서 시작하고, 패키지 검사는 명세의 cwd로 실행한다. `verify`는 전달한 시작 위치를 경고하고, Claude 계측 시험은 시작 훅 미확인 시 모델 호출 전에 멈춘다. 시작 훅 관찰을 가드 차단 검증으로 대신하지 않는다. [실측 결과와 제한](../../../docs/analysis/hook-runtime-evaluation.md).

## 승인과 지속 정책

사용자의 단발 커밋·푸시 요청과 `allowCommitPush` 영구 설정은 별개다. 앱 권한은 실행 시 승인 여부를 다루고 훅은 저장소에 정한 지속 정책을 적용한다. 단발 요청만으로 설정을 변경하지 않는다. 현재 설정이 요청을 막으면 원인을 알리고, 팀이 지속 정책 변경까지 요청했을 때만 수정한다. 승인 판독이나 일회성 우회 토큰을 훅에 구현하지 않는다.
