# 훅·권한 구성 — 절대 규칙의 기계적 강제

프롬프트 지침은 컨텍스트가 길어지면 무시될 수 있다. 절대 규칙 중 기계적으로 강제 가능한 것(git 금지, 시크릿 차단)은 생성하는 하네스의 `.claude/settings.json`에 훅·권한으로 내장한다. 지침은 "왜"를 전달하고, 훅은 어겨질 수 없게 만든다 — 둘 다 필요하다.

## 목차
1. [훅 스크립트 설치 — assets/에서 복사](#1-훅-스크립트-설치--assets에서-복사)
2. [git 차단 훅 (blockGitMutation)](#2-git-차단-훅-blockgitmutation)
3. [시크릿 차단 — deny + 훅의 2중 방어](#3-시크릿-차단--deny--훅의-2중-방어)
4. [TDD 종료 게이트 (Stop 훅, 선택)](#4-tdd-종료-게이트-stop-훅-선택)
5. [allowlist — 자율 실행 보장](#5-allowlist--자율-실행-보장)
6. [기존 설정과의 병합 규칙](#6-기존-설정과의-병합-규칙)

## 1. 훅 스크립트 설치 — assets/에서 복사

훅 스크립트는 이 스킬의 `assets/hooks/`에 실물 파일로 번들되어 있다(회귀 테스트: `scripts/hooks.test.mjs`). 문서에서 베껴 쓰지 말고 그대로 복사한다 — 복사가 결정적이어야 프로젝트마다 미묘하게 다른 사본이 생기지 않는다.

```bash
mkdir -p "$PROJECT/.claude/hooks"
cp "{이 스킬 경로}/assets/hooks/blockGitMutation.mjs" \
   "{이 스킬 경로}/assets/hooks/blockSecretAccess.mjs" \
   "$PROJECT/.claude/hooks/"
```

`프로젝트/.claude/settings.json`에 두 훅을 등록한다. PreToolUse 훅은 도구 실행 전에 호출되며, **exit code 2면 호출이 차단되고 stderr가 에이전트에게 피드백**으로 전달된다:

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
      }
    ]
  }
}
```

## 2. git 차단 훅 (blockGitMutation)

절대 규칙 1(git 작업은 사용자 전담)을 강제한다.

**차단 범위 원칙:** 변경 명령만 막는다. `git status`·`diff`·`log`·`show`·`blame` 같은 읽기 명령은 에이전트의 작업 파악에 필요하므로 허용한다. 도메인 특성상 `checkout`/`switch`가 필요한 하네스(예: 브랜치별 검수)라면 사용자 확인 후 패턴에서 제외하고, 제외 사유를 스크립트 주석에 남긴다.

**우회 방지:** 판정 정규식은 서브커맨드 앞의 전역 플래그를 건너뛴다. `-C <path>`·`-c <k=v>`·`--git-dir <path>`처럼 **값을 별도 인자로 받는 플래그**를 처리하지 않으면 `git -C /repo commit` 같은 우회가 생긴다 — 패턴을 수정할 때는 반드시 `scripts/hooks.test.mjs`의 차단/허용 케이스를 함께 갱신하고 통과를 확인한다.

## 3. 시크릿 차단 — deny + 훅의 2중 방어

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

## 4. TDD 종료 게이트 (Stop 훅, 선택)

절대 규칙 2(종료 기준 = 테스트 전체 통과)를 기계적으로 강제하는 선택 장치다. Stop 훅에서 테스트를 실행해 실패하면 exit 2로 턴 종료를 차단한다 — 에이전트는 실패 출력을 피드백으로 받고 수정을 계속한다.

테스트 명령이 프로젝트마다 달라 assets/로 번들하지 않는다. 아래 템플릿의 `{TEST_COMMAND}`를 채워 `.claude/hooks/gateTestsOnStop.mjs`로 생성한다:

```js
#!/usr/bin/env node
// Stop 훅 — 테스트 실패 상태로 턴을 끝내지 못하게 막는다 (절대 규칙 2).
import { execSync } from 'node:child_process';
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
if (input.stop_hook_active) process.exit(0); // 이 훅이 이미 차단한 재시도 — 무한 루프 방지
try {
  execSync('{TEST_COMMAND}', { stdio: 'pipe', timeout: 300000 });
} catch (error) {
  const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.slice(0, 4000);
  console.error(`테스트 실패 상태로 종료할 수 없다. 실패를 수정하라:\n${output}`);
  process.exit(2);
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
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/gateTestsOnStop.mjs\""
          }
        ]
      }
    ]
  }
}
```

**적용 조건:** 코드 생성 하네스이고, 테스트가 수 분 안에 끝나야 한다(모든 턴 종료마다 실행되므로 느린 스위트는 세션 전체를 마비시킨다). `stop_hook_active` 가드는 삭제 금지 — 없으면 "테스트 실패 → 차단 → 재시도 → 차단"의 무한 루프에 빠진다. 구성 전에 사용자에게 확인한다.

## 5. allowlist — 자율 실행 보장

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

**선정 기준:** 오케스트레이터·에이전트 정의가 명시하는 검증 명령(테스트·타입체크·린트·빌드)만. `rm`·패키지 publish·배포 명령처럼 파괴적이거나 외부로 나가는 명령은 절대 사전 허용하지 않는다. git은 allowlist가 아니라 2번 훅으로 다룬다.

## 6. 기존 설정과의 병합 규칙

- `.claude/settings.json`이 이미 존재하면 **덮어쓰지 말고 읽어서 병합한다.** 기존 hooks·permissions 항목은 보존하고 하네스 항목만 추가한다.
- 기존 훅과 충돌(같은 matcher에 상반된 동작)이 보이면 임의 판단하지 말고 사용자에게 확인한다 — 절대 규칙 4(단일 출처)와 같은 원리다.
- 훅·권한은 프로젝트 공유 자산이므로 `settings.json`에 쓴다. `settings.local.json`(개인 설정)에 넣으면 다른 사용자의 세션에서 절대 규칙이 강제되지 않는다.
- 구성 후 변경 내용을 CLAUDE.md 변경 이력에 기록한다. 해체 시에는 하네스가 추가한 훅 등록·`.claude/hooks/` 스크립트·deny/allow 항목을 같은 경로로 제거한다.
