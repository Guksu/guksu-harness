# 훅·권한 구성 — 절대 규칙의 기계적 강제

프롬프트 지침은 컨텍스트가 길어지면 무시될 수 있다. 절대 규칙 중 기계적으로 강제 가능한 것(git 금지, 시크릿 차단)은 생성하는 하네스의 `.claude/settings.json`에 훅·권한으로 내장한다. 지침은 "왜"를 전달하고, 훅은 어겨질 수 없게 만든다 — 둘 다 필요하다.

## 목차
1. [git 차단 훅 (PreToolUse)](#1-git-차단-훅-pretooluse)
2. [시크릿 차단 (permissions.deny)](#2-시크릿-차단-permissionsdeny)
3. [allowlist — 자율 실행 보장](#3-allowlist--자율-실행-보장)
4. [기존 설정과의 병합 규칙](#4-기존-설정과의-병합-규칙)

## 1. git 차단 훅 (PreToolUse)

절대 규칙 1(git 작업은 사용자 전담)을 강제한다. PreToolUse 훅은 도구 실행 전에 호출되며, **exit code 2면 호출이 차단되고 stderr가 에이전트에게 피드백**으로 전달된다.

`프로젝트/.claude/settings.json`:

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
          }
        ]
      }
    ]
  }
}
```

`프로젝트/.claude/hooks/blockGitMutation.mjs`:

```js
#!/usr/bin/env node
// PreToolUse 훅 — git 변경 명령을 차단한다 (절대 규칙: git 작업은 사용자 전담).
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const { tool_input } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const command = tool_input?.command ?? '';

const GIT_MUTATION =
  /\bgit\s+(?:-\S+\s+)*(commit|push|merge|rebase|reset|revert|cherry-pick|tag|stash|switch|checkout|am|apply|branch\s+(?:-[dDmM]|--delete))\b/;

if (GIT_MUTATION.test(command)) {
  console.error(
    '차단됨: git 변경 작업은 사용자 전담입니다. 변경 요약을 보고하고 "커밋은 직접 진행하세요"로 안내하세요.',
  );
  process.exit(2);
}
```

**차단 범위 원칙:** 변경 명령만 막는다. `git status`·`diff`·`log`·`show`·`blame` 같은 읽기 명령은 에이전트의 작업 파악에 필요하므로 허용한다. 도메인 특성상 `checkout`/`switch`가 필요한 하네스(예: 브랜치별 검수)라면 사용자 확인 후 패턴에서 제외하고, 제외 사유를 스크립트 주석에 남긴다.

## 2. 시크릿 차단 (permissions.deny)

절대 규칙 6(시크릿 읽기·기록 금지)의 읽기 측은 훅 없이 deny 권한만으로 강제된다:

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

프로젝트의 실제 시크릿 위치(`.gitignore`에 단서가 있다)를 확인해 패턴을 맞춘다. 기록 측(산출물에 토큰을 옮겨 적지 않는다)은 기계적 강제가 어려우므로 에이전트 정의의 작업 원칙으로 명시한다.

## 3. allowlist — 자율 실행 보장

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

**선정 기준:** 오케스트레이터·에이전트 정의가 명시하는 검증 명령(테스트·타입체크·린트·빌드)만. `rm`·패키지 publish·배포 명령처럼 파괴적이거나 외부로 나가는 명령은 절대 사전 허용하지 않는다. git은 allowlist가 아니라 1번 훅으로 다룬다.

## 4. 기존 설정과의 병합 규칙

- `.claude/settings.json`이 이미 존재하면 **덮어쓰지 말고 읽어서 병합한다.** 기존 hooks·permissions 항목은 보존하고 하네스 항목만 추가한다.
- 기존 훅과 충돌(같은 matcher에 상반된 동작)이 보이면 임의 판단하지 말고 사용자에게 확인한다 — 절대 규칙 4(단일 출처)와 같은 원리다.
- 훅·권한은 프로젝트 공유 자산이므로 `settings.json`에 쓴다. `settings.local.json`(개인 설정)에 넣으면 다른 사용자의 세션에서 절대 규칙이 강제되지 않는다.
- 구성 후 변경 내용을 CLAUDE.md 변경 이력에 기록한다.
