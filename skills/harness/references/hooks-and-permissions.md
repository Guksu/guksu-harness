# 보호 장치와 프로젝트 설정

훅은 Claude Code의 도구 실행·종료 이벤트에 연결되는 스크립트다. 등록된 경로에서 실수를 줄이지만 모든 셸 우회나 다른 앱까지 막는 보안 경계는 아니다. 사용자 승인 여부는 스킬이 대화에서 판단한다.

## 1. 설치와 기존 설정 보존

`harnessManager.mjs plan`으로 파일과 설정 변경을 확인하고 `apply`로 적용한다 → `installation.md`.

기본 훅 3종은 `.claude/hooks/`에 복사하고 `.claude/settings.json`의 `PreToolUse`에 등록한다. 기본 등록 형태:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/blockGitMutation.mjs\"" },
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/blockSecretAccess.mjs\"" }
        ]
      },
      {
        "matcher": "Edit|Write|NotebookEdit",
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/branchGuard.mjs\"" }]
      }
    ]
  }
}
```

관리자는 같은 의미의 훅을 개별 등록 항목으로 추가한다. 수동 등록이나 다른 도구의 항목을 덮어쓰지 않는다. 개인 설정은 자동 수정하지 않는다.

## 2. git 명령 보호

`blockGitMutation.mjs`는 기본적으로 commit·push 등 변경 명령을 차단한다. 읽기 명령과 일반 `git switch`·스테이징은 허용한다. switch의 강제·변경 폐기·detached HEAD 옵션과 merge·rebase·reset·원격 삭제 등은 계속 차단한다.

`blockGitMutation.config.json`:

```json
{
  "allowCommitPush": true,
  "requireHistoryDoc": true,
  "historyBase": "origin/main",
  "blockAttribution": false
}
```

| 설정 | 동작 |
|---|---|
| allowCommitPush | 기본 false. 영구 허용은 사용자가 요청한 경우에만 설정 |
| requireHistoryDoc | commit·push 허용 시 기본 true. push할 변경에 `docs/history/*.md`를 요구 |
| historyBase | 생략 시 dev·main·master 계열을 탐색. 프로젝트 기준 브랜치를 지정하는 편이 명확함 |
| blockAttribution | 기본 false. true이면 Claude 작성자 표기 패턴을 차단 |

설정 파일이 없거나 파싱에 실패하면 커밋·푸시 예외는 비활성이다. 기록 기준을 찾지 못하면 기록 게이트는 통과하므로 승인·보안 장치로 사용하지 않는다. 기존 표기 제한을 유지하려면 업데이트 전에 `blockAttribution: true`를 설정한다.

허용 상태에서도 force/delete push와 간접 커밋 메시지 옵션(`-F`, `-t`, `-c`, `-C`, amend/fixup 등)은 차단한다. 일반 커밋 메시지는 `-m`으로 전달한다. 이 검사는 셸 파서 전체를 대체하지 않는다.

## 3. 보호 브랜치

`branchGuard.mjs`는 Edit·Write·NotebookEdit에서 보호 브랜치 편집을 차단한다.

```json
{ "protectedBranches": ["main", "master"] }
```

설정 파일은 `branchGuard.config.json`이다. 없으면 main·master를 사용하며 JSON 파싱 오류는 편집을 차단한다. 브랜치 이름은 정확히 일치해야 하며 와일드카드를 지원하지 않는다. git 저장소가 아니거나 detached HEAD·브랜치 조회 실패면 비활성이다. Bash로 파일을 쓰는 경로는 검사하지 않으므로 작업 시작 시 브랜치 확인을 병행한다.

## 4. 민감정보 접근

`blockSecretAccess.mjs`는 알려진 민감정보 경로의 Bash 접근을 검사한다. Read 도구는 공유 설정의 deny를 함께 구성한다:

```json
{
  "permissions": {
    "deny": ["Read(./.env)", "Read(./.env.*)", "Read(./**/credentials*)", "Read(./**/*.pem)", "Read(./**/secrets/**)"]
  }
}
```

프로젝트의 실제 경로가 다르면 패턴도 조정한다. 실제 키 값을 조사하거나 출력하지 않는다. Bash 훅과 Read deny의 적용 경로는 다르며, 예시 파일의 예외도 각 도구 설정에서 확인한다.

## 5. 종료 검사 (선택)

`verifierGate.mjs`를 Stop에 등록한다. 관리자의 `plan --verifier`로 파일·등록을 추가하고, 훅 옆 `verifierGate.config.json`에 검사 명령을 쓴다.

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
- `maxTokens`는 선택이며 transcript 입력·출력·캐시 생성의 누적 근사치다. 과금액이나 실시간 상한이 아니다. 설정했지만 transcript를 읽지 못하면 사유를 보고하고 중단한다.
- 설정 오류는 검사 성공으로 처리하지 않는다. 오류 보고 후 종료한다.
- 건당 검사 명령은 최대 5분이다. 한 번의 명령 실행 도중 예산 초과를 감지해 취소하지 않으며 강제 앱 종료까지 막지는 않는다.

Stop 훅을 새로 등록하는 것과 한 작업에서 테스트를 재시도하는 것은 다르다. 일반적인 개발 재시도에는 이 설정을 요구하지 않는다.

## 6. 사전 허용과 확인

자주 실행하는 테스트·타입체크는 프로젝트에서 부수효과를 확인한 뒤 allowlist로 허용할 수 있다. 배포·패키지 발행·실제 결제 등 외부 영향이 있는 작업은 일괄 허용하지 않는다. 이미 받은 승인은 유지하되 단발 요청을 영구 권한 확대로 바꾸지 않는다.

## 7. 제거

관리 도구는 자신이 추가한 정확한 훅·deny 항목만 해제한다. 사용자가 수정한 등록이나 파일은 충돌로 보존한다. 수동 설치의 출처가 불명확하면 목록을 보고하고 삭제를 추측하지 않는다. 문서·사용자 기록은 보존한다.
