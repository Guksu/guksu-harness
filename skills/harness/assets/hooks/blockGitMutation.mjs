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
    String.raw`(?:commit|push|merge|rebase|reset|revert|cherry-pick|tag|stash|switch|checkout|am|apply|worktree|branch\s+(?:-[dDmM]|--delete))\b`,
);
// 차단 범위 원칙: 변경 명령만 막는다. status·diff·log·show·blame 같은 읽기 명령은
// 에이전트의 작업 파악에 필요하므로 허용한다. 도메인 특성상 checkout/switch가 필요한
// 하네스라면 사용자 확인 후 패턴에서 제외하고, 제외 사유를 여기에 주석으로 남긴다.

export const isGitMutation = (command) => GIT_MUTATION.test(command);

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const { tool_input } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (isGitMutation(tool_input?.command ?? '')) {
    console.error(
      '차단됨: git 변경 작업은 사용자 전담입니다. 변경 요약을 보고하고 "커밋은 직접 진행하세요"로 안내하세요.',
    );
    process.exit(2);
  }
}
