# 훅·권한 구성 — 절대 규칙의 기계적 강제

프롬프트 지침은 컨텍스트가 길어지면 무시될 수 있다. 절대 규칙 중 기계적으로 강제 가능한 것(git 금지, 시크릿 차단)은 생성하는 하네스의 `.claude/settings.json`에 훅·권한으로 내장한다. 지침은 "왜"를 전달하고, 훅은 어겨질 수 없게 만든다 — 둘 다 필요하다.

## 위험 등급 — 가드레일의 조직 원리

가드레일은 allow/block 이분법이 아니라 **도구·명령의 위험 등급**으로 설계한다(OpenAI 가이드). Phase 2에서 하네스가 실행할 도구·명령을 인벤토리로 뽑고, 각각을 아래 3등급으로 분류해 등급에 맞는 강제 수단을 붙인다. 등급 기준은 **읽기 전용인가 / 가역적인가 / 권한 범위 / 재정적·외부 영향**이다.

| 등급 | 기준 | 강제 수단 | 이 문서 |
|------|------|----------|---------|
| **low** | 읽기 전용·가역적·부작용 없음 (테스트·타입체크·린트·빌드·status/diff) | allowlist로 사전 허용 — 자율 실행이 프롬프트에 끊기지 않게 | §6 |
| **medium** | 쓰기지만 프로젝트 내부·가역적 (파일 편집, 로컬 파일 생성) | 기본 권한(사용자 확인 흐름). branchGuard는 보호 브랜치 편집만 medium→차단으로 승격 | §3 |
| **high** | 비가역·외부 영향·파괴적 (git 변경, 시크릿 읽기, 배포·publish, `rm`, 자금 이동) | deny + PreToolUse 훅으로 차단하거나 사용자 확인 필수. allowlist에 절대 넣지 않는다 | §2·§4 |

기존 훅 3종은 모두 **high 등급의 구현 사례**다: git 변경(§2)·시크릿 접근(§4)·보호 브랜치 편집(§3). 새 도메인의 하네스를 만들 때는 이 목록을 그대로 쓰지 말고, 그 도메인의 도구를 3등급으로 재분류해 high에 해당하는 것에 훅·deny를 붙인다 — 예: 결제 API 호출, 프로덕션 DB 마이그레이션, 외부 알림 발송. 판단이 애매하면 높은 등급으로 올린다(가드레일은 낙관적 실행과 병행되므로, 과한 차단이 놓친 차단보다 싸다).

## 목차
1. [훅 스크립트 설치 — assets/에서 복사](#1-훅-스크립트-설치--assets에서-복사)
2. [git 차단 훅 (blockGitMutation)](#2-git-차단-훅-blockgitmutation)
3. [브랜치 가드 (branchGuard)](#3-브랜치-가드-branchguard)
4. [시크릿 차단 — deny + 훅의 2중 방어](#4-시크릿-차단--deny--훅의-2중-방어)
5. [검증자 게이트 (Stop 훅, 선택)](#5-검증자-게이트-stop-훅-선택)
6. [allowlist — 자율 실행 보장](#6-allowlist--자율-실행-보장)
7. [기존 설정과의 병합 규칙](#7-기존-설정과의-병합-규칙)

## 1. 훅 스크립트 설치 — assets/에서 복사

훅 스크립트는 이 스킬의 `assets/hooks/`에 실물 파일로 번들되어 있다(회귀 테스트: `scripts/hooks.test.mjs`). 문서에서 베껴 쓰지 말고 그대로 복사한다 — 복사가 결정적이어야 프로젝트마다 미묘하게 다른 사본이 생기지 않는다.

```bash
mkdir -p "$PROJECT/.claude/hooks"
cp "{이 스킬 경로}/assets/hooks/blockGitMutation.mjs" \
   "{이 스킬 경로}/assets/hooks/blockSecretAccess.mjs" \
   "{이 스킬 경로}/assets/hooks/branchGuard.mjs" \
   "$PROJECT/.claude/hooks/"
# 선택 — 검증자 게이트(§5)를 적용하는 하네스만:
# cp "{이 스킬 경로}/assets/hooks/verifierGate.mjs" "$PROJECT/.claude/hooks/"
```

`프로젝트/.claude/settings.json`에 훅을 등록한다. PreToolUse 훅은 도구 실행 전에 호출되며, **exit code 2면 호출이 차단되고 stderr가 에이전트에게 피드백**으로 전달된다:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/blockGitMutation.mjs\""
          },
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/blockSecretAccess.mjs\""
          }
        ]
      },
      {
        "matcher": "Edit|Write|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/branchGuard.mjs\""
          }
        ]
      }
    ]
  }
}
```

## 2. git 차단 훅 (blockGitMutation)

절대 규칙 1(git 작업은 사용자 전담)을 강제한다.

**차단 범위 원칙:** 변경 명령만 막는다. `git status`·`diff`·`log`·`show`·`blame` 같은 읽기 명령은 에이전트의 작업 파악에 필요하므로 허용한다. **switch는 예외로 허용된다** — 순수 브랜치 전환(`git switch <b>`·`-c <b>`)은 작업 내용을 파괴하지 않으며(충돌 시 git이 거부), `branch` 스킬이 사용자 확인 후에만 사용한다. 단 파괴·이탈 플래그(`-f`/`--force`·`--discard-changes`·`-C`/`--force-create`·`--orphan`(워킹트리 비움)·`-d`/`--detach`(detached HEAD — branchGuard 무력화))와 `checkout`(파일 복원 기능 포함)·`restore`·`clean`(워킹트리 파괴 계열)은 계속 차단한다. 판정은 토큰 단위다 — git의 번들(`-fc`)·값 붙임(`-Cmain`)·따옴표(`"-f"`) 형태까지 잡는다.

**우회 방지:** 판정 정규식은 서브커맨드 앞의 전역 플래그를 건너뛴다. `-C <path>`·`-c <k=v>`·`--git-dir <path>`처럼 **값을 별도 인자로 받는 플래그**를 처리하지 않으면 `git -C /repo commit` 같은 우회가 생긴다 — 패턴을 수정할 때는 반드시 `scripts/hooks.test.mjs`의 차단/허용 케이스를 함께 갱신하고 통과를 확인한다.

## 3. 브랜치 가드 (branchGuard)

"작업 시작 전에 작업 브랜치부터 확인"(`branch` 스킬)을 기계적으로 강제한다. matcher `Edit|Write|NotebookEdit`로 등록되어(§1) 보호 브랜치 위에서의 파일 편집 시도를 차단하고, branch 스킬로 사용자 확인을 받으라는 피드백을 전달한다.

- **판정:** `.git/HEAD`를 직접 읽는다(서브프로세스 없음, worktree의 `gitdir:` 포인터 추적). detached HEAD·git 저장소 아님이면 비활성(무해).
- **설정:** 스크립트 옆 `branchGuard.config.json`의 `protectedBranches`(기본 `["main", "master"]`). 프로젝트의 실제 기본/배포 브랜치(`develop`·`release/*` 운용 등)에 맞게 구축 시 사용자와 확인해 조정한다.

```json
{ "protectedBranches": ["main", "master"] }
```

- **한계:** Edit/Write/NotebookEdit 도구만 막는다 — Bash 경유 파일 쓰기(`echo > file`)는 걸러지지 않으므로, 에이전트 정의의 작업 원칙("파일 변경 작업 시작 전 branch 스킬로 브랜치 확인")과 병행한다. 보호 브랜치에서 의도적으로 계속하려면 사용자가 직접 config를 수정한다 — 에이전트가 대신 수정하지 않는다.

## 4. 시크릿 차단 — deny + 훅의 2중 방어

절대 규칙 6(시크릿 읽기·기록 금지)의 읽기 측은 두 겹으로 강제한다. **deny 권한은 Read 도구만 막는다** — `cat .env`·`grep KEY .env` 같은 Bash 경유 읽기는 deny로 막히지 않으므로, `blockSecretAccess.mjs` 훅(§1에서 설치)이 그 우회 경로를 닫는다.

```json
{
  "permissions": {
    "deny": [
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./**/credentials*)",
      "Read(./**/*.pem)",
      "Read(./**/secrets/**)"
    ]
  }
}
```

프로젝트의 실제 시크릿 위치(`.gitignore`에 단서가 있다)를 확인해 deny 패턴과 훅의 판정 패턴을 **같이** 맞춘다 — 두 겹의 커버리지가 어긋나면 우회 경로가 되살아난다. `.env.example` 같은 관례적 예시 파일은 훅이 허용한다. 기록 측(산출물에 토큰을 옮겨 적지 않는다)은 기계적 강제가 어려우므로 에이전트 정의의 작업 원칙으로 명시한다.

## 5. 검증자 게이트 (Stop 훅, 선택)

종료 규칙(검증 명령 전체 통과)을 기계적으로 강제하는 선택 장치다. `assets/hooks/verifierGate.mjs`를 §1과 같은 방식으로 `.claude/hooks/`에 복사하고, 스크립트 **옆에** `verifierGate.config.json`으로 검증 명령과 안전장치를 정의한다 (config가 없으면 게이트는 비활성):

```json
{
  "checks": [
    { "name": "test", "command": "npm test" },
    { "name": "typecheck", "command": "npx tsc --noEmit" }
  ],
  "maxIterations": 10,
  "maxTokens": 500000,
  "stuckAfter": 3
}
```

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/verifierGate.mjs\""
          }
        ]
      }
    ]
  }
}
```

**동작 (판정 순서가 규칙이다):**
1. `checks` 전체 통과 → 종료 허용 (수렴 성공 — 예산과 무관). 막힘 추적(signature/streak)만 초기화한다 — `iterations`는 세션별 누적 상한이라 리셋하지 않는다(리셋하면 flaky 체크가 한 번 통과할 때마다 maxIterations가 무력화된다).
2. 실패가 남았는데 **안전장치 도달** → 루프를 계속하지 않는다. "진행 상황·남은 실패·중단 사유를 보고하고 종료하라"를 지시하고, 그 보고 후 종료는 통과시킨다. 안전장치 3종:
   - `maxTokens` — transcript 누적 토큰 초과 (토큰 예산 자동 중단)
   - `maxIterations` — 세션별 차단 횟수 도달
   - `stuckAfter` — **같은 실패 시그니처가 N연속**(막힘 판정). 시그니처는 실패한 검증 이름 + 출력 전체(숫자·공백 정규화, 500자 캡)로 만든다 — 첫 줄만 쓰면 npm 배너 같은 고정 줄이 모든 실패를 동일하게 만들어 수렴 중인 루프를 오판한다. 진전 없이 같은 에러만 반복되면 예산을 소진하기 전에 중단시킨다. `docs/loops/` 명세의 "막힘 판정" 값과 일치시킨다.
3. 실패 + 여력 있음 → exit 2로 종료를 차단하고 실패 출력을 피드백으로 전달한다.

절대 규칙 2의 TDD 게이트는 `checks`에 테스트 명령 하나만 넣은 특수 사례다. 루프 하네스에서는 `docs/loops/` 명세의 검증자·안전장치 값과 config를 **일치**시킨다 (loop 스킬 참조).

**적용 조건:** checks가 수 분 안에 끝나야 한다(모든 턴 종료마다 실행되므로 느린 스위트는 세션 전체를 마비시킨다). 스크립트의 `stop_hook_active` 가드는 삭제 금지 — 없으면 "실패 → 차단 → 재시도 → 차단"의 무한 루프에 빠진다. 구성 전에 사용자에게 확인한다.

## 6. allowlist — 자율 실행 보장

에이전트 팀·Workflow가 매 테스트 실행마다 권한 프롬프트에 막히면 자율 실행이 끊긴다(특히 백그라운드 팀원은 프롬프트에 응답할 수 없다). 하네스가 반복 실행할 명령을 구축 시점에 미리 허용한다:

```json
{
  "permissions": {
    "allow": [
      "Bash(npm test:*)",
      "Bash(npm run build:*)",
      "Bash(npx vitest:*)",
      "Bash(npx tsc:*)"
    ]
  }
}
```

**선정 기준:** 위험 등급 **low**(읽기 전용·가역·부작용 없음)만 allowlist에 넣는다 — 오케스트레이터·에이전트 정의가 명시하는 검증 명령(테스트·타입체크·린트·빌드). `rm`·패키지 publish·배포 명령처럼 파괴적이거나 외부로 나가는 명령(high)은 절대 사전 허용하지 않는다. git은 allowlist가 아니라 2번 훅으로 다룬다. 등급 분류는 위 "위험 등급" 표를 따른다.

## 7. 기존 설정과의 병합 규칙

- `.claude/settings.json`이 이미 존재하면 **덮어쓰지 말고 읽어서 병합한다.** 기존 hooks·permissions 항목은 보존하고 하네스 항목만 추가한다.
- 기존 훅과 충돌(같은 matcher에 상반된 동작)이 보이면 임의 판단하지 말고 사용자에게 확인한다 — 절대 규칙 4(단일 출처)와 같은 원리다.
- 훅·권한은 프로젝트 공유 자산이므로 `settings.json`에 쓴다. `settings.local.json`(개인 설정)에 넣으면 다른 사용자의 세션에서 절대 규칙이 강제되지 않는다.
- 구성 후 변경 내용을 CLAUDE.md 변경 이력에 기록한다. 해체 시에는 하네스가 추가한 훅 등록·`.claude/hooks/` 스크립트·deny/allow 항목을 같은 경로로 제거한다.
