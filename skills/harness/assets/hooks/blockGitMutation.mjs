#!/usr/bin/env node
// PreToolUse 훅 (matcher: Bash) — git 변경 명령을 차단한다 (절대 규칙 1: git 작업은 사용자 전담).
// exit 2면 호출이 차단되고 stderr가 에이전트에게 피드백으로 전달된다.
import { fileURLToPath } from 'node:url';

// 서브커맨드 앞의 전역 플래그를 건너뛴 뒤 판정한다. -C <path>·-c <k=v>·--git-dir <path>처럼
// 값을 별도 인자로 받는 플래그를 놓치면 `git -C /repo commit` 같은 우회가 생긴다.
const GIT_GLOBAL_FLAGS =
  /(?:-[cC]\s+\S+\s+|--(?:git-dir|work-tree|namespace|exec-path)\s+\S+\s+|-\S+\s+)*/;
const GIT_MUTATION = new RegExp(
  String.raw`\bgit\s+` +
    GIT_GLOBAL_FLAGS.source +
    String.raw`(?:commit|push|merge|rebase|reset|revert|cherry-pick|tag|stash|checkout|am|apply|worktree|branch\s+(?:-[dDmM]|--delete))\b`,
);
// 차단 범위 원칙: 변경 명령만 막는다. status·diff·log·show·blame 같은 읽기 명령은
// 에이전트의 작업 파악에 필요하므로 허용한다.
//
// switch 예외 (v1.9.0, 사용자 승인): 순수 브랜치 전환(`git switch <b>`·`git switch -c <b>`)은
// branch 스킬이 사용자 확인 후 수행하도록 허용한다 — switch는 커밋·푸시와 달리 작업 내용을
// 파괴하지 않고, 로컬 변경과 충돌하면 git이 스스로 거부한다. 단 작업 내용을 버릴 수 있는
// 플래그(-f/--force·--discard-changes·-C/--force-create)는 계속 차단한다.
// checkout은 파일 복원(git checkout -- <path>) 기능이 있어 전체 차단을 유지한다.
const GIT_SWITCH = new RegExp(
  String.raw`\bgit\s+` + GIT_GLOBAL_FLAGS.source + String.raw`switch\b([^&|;]*)`,
);
const SWITCH_DESTRUCTIVE = /(?:^|\s)(?:-f|-C|--force(?:-create)?|--discard-changes)\b/;

export const isGitMutation = (command) => {
  if (GIT_MUTATION.test(command)) return true;
  const switchMatch = command.match(GIT_SWITCH);
  return switchMatch != null && SWITCH_DESTRUCTIVE.test(switchMatch[1]);
};

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const { tool_input } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (isGitMutation(tool_input?.command ?? '')) {
    console.error(
      '차단됨: git 변경 작업은 사용자 전담입니다. 변경 요약을 보고하고 "커밋은 직접 진행하세요"로 안내하세요. ' +
        '브랜치 전환이 필요하면 branch 스킬로 사용자 확인 후 git switch(-c)를 사용하세요 — force/discard 플래그는 허용되지 않습니다.',
    );
    process.exit(2);
  }
}
