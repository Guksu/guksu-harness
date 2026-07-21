#!/usr/bin/env node
// PreToolUse 훅 (matcher: Bash) — git 변경 명령을 차단한다 (절대 규칙 1: git 작업은 사용자 전담).
// exit 2면 호출이 차단되고 stderr가 에이전트에게 피드백으로 전달된다.
//
// 예외는 2종이며 모두 사용자 승인 기반이다:
//   1. switch — 순수 브랜치 전환은 branch 스킬이 사용자 확인 후 수행한다 (아래 주석).
//   2. commit·push — 스크립트 옆 blockGitMutation.config.json이 { "allowCommitPush": true }일 때만
//      허용되는 옵트인(pr 스킬 — 사용자가 명시 요청한 커밋·PR 업로드). 이때도 Claude 작성 표기가
//      든 커밋 메시지, 메시지를 검사할 수 없는 커밋 형태(-F/-t/-c/-C/--amend 등), force/delete
//      push는 계속 차단한다. config가 없거나 파싱에 실패하면 예외는 비활성(기본 차단)이다.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 서브커맨드 앞의 전역 플래그를 건너뛴 뒤 판정한다. -C <path>·-c <k=v>·--git-dir <path>처럼
// 값을 별도 인자로 받는 플래그를 놓치면 `git -C /repo commit` 같은 우회가 생긴다.
const GIT_GLOBAL_FLAGS =
  /(?:-[cC]\s+\S+\s+|--(?:git-dir|work-tree|namespace|exec-path)\s+\S+\s+|-\S+\s+)*/;
const gitSubcommand = (alternatives) =>
  new RegExp(String.raw`\bgit\s+` + GIT_GLOBAL_FLAGS.source + String.raw`(?:${alternatives})\b`);
// commit·push를 제외한 변경 명령 — commit·push 예외(allowCommitPush)에서도 이 목록은 항상 차단이다.
const MUTATION_CORE = String.raw`merge|rebase|reset|revert|cherry-pick|tag|stash|checkout|restore|clean|am|apply|worktree|branch\s+(?:-[dDmM]|--delete)`;
const GIT_MUTATION = gitSubcommand(String.raw`commit|push|${MUTATION_CORE}`);
const GIT_MUTATION_EXCEPT_COMMIT_PUSH = gitSubcommand(MUTATION_CORE);
// 차단 범위 원칙: 변경 명령만 막는다. status·diff·log·show·blame 같은 읽기 명령은
// 에이전트의 작업 파악에 필요하므로 허용한다. add(스테이징)도 가역적이라 허용한다.
//
// switch 예외 (v1.9.0, 사용자 승인): 순수 브랜치 전환(`git switch <b>`·`git switch -c <b>`)은
// branch 스킬이 사용자 확인 후 수행하도록 허용한다 — switch는 커밋·푸시와 달리 작업 내용을
// 파괴하지 않고, 로컬 변경과 충돌하면 git이 스스로 거부한다. 단 작업 내용을 버리거나(-f/-C/
// --discard-changes) 워킹트리를 비우거나(--orphan) 보호 브랜치 가드를 무력화하는
// (-d/--detach — detached HEAD에서는 branchGuard가 비활성) 플래그는 계속 차단한다.
// checkout은 파일 복원(git checkout -- <path>) 기능이 있어 전체 차단을 유지하고, 같은 이유로
// 워킹트리를 파괴하는 현대적 등가 명령 restore·clean도 차단한다.
// 꼬리 캡처는 명령 구분자와 개행에서 끊는다 — 개행을 포함하면 멀티라인 명령의 다음 줄
// 플래그가 switch 인자로 오인된다. /g로 전체를 훑는다 — `switch -c a && switch -f b`처럼
// 한 명령 안의 두 번째 switch도 검사해야 한다.
const subcommandWithTail = (name) =>
  new RegExp(String.raw`\bgit\s+` + GIT_GLOBAL_FLAGS.source + name + String.raw`\b([^&|;\n]*)`, 'g');
const GIT_SWITCH = subcommandWithTail('switch');
const GIT_COMMIT = subcommandWithTail('commit');
const GIT_PUSH = subcommandWithTail('push');

// git parse-options는 단축 옵션의 번들(-fc = -f -c)과 값 붙임(-Cmain = -C main)을 허용하고,
// 셸은 따옴표를 벗겨 전달한다("-f" → -f). 정규식 한 줄로는 이 형태들을 놓치므로 토큰 단위로
// 검사한다. 단축 클러스터에 금지 문자가 보이면 차단 — -cf(f라는 브랜치 생성) 같은 드문 오탐은
// 감수한다(가드는 fail-closed가 원칙).
const tailHasFlag = (tail, longFlag, shortLetters) =>
  tail
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(/^["']+|["']+$/g, ''))
    .some(
      (token) =>
        longFlag.test(token) || (/^-[^-]/.test(token) && shortLetters.test(token.slice(1))),
    );

const DESTRUCTIVE_SWITCH_LONG = /^--(?:force(?:-create)?|discard-changes|orphan|detach)(?:=|$)/;
const isDestructiveSwitchTail = (tail) => tailHasFlag(tail, DESTRUCTIVE_SWITCH_LONG, /[fCd]/);

// commit 예외에서도 계속 차단하는 형태: --amend(히스토리 재작성)와 메시지가 명령문 밖에 있어
// 검사할 수 없는 간접 메시지 플래그(-F/--file·-t/--template·-c/-C/--reuse-message 계열·
// --fixup/--squash). 메시지는 -m 인라인으로만 작성해야 Claude 표기 검사가 가능하다.
const UNSAFE_COMMIT_LONG =
  /^--(?:amend|file|template|reuse-message|reedit-message|fixup|squash)(?:=|$)/;
const UNSAFE_COMMIT_SHORT = /[FCct]/;
// push 예외에서도 계속 차단: force 계열(원격 히스토리 덮어쓰기)·delete(원격 브랜치 삭제)·
// mirror·prune. 일반 push(-u 포함)만 허용한다.
const UNSAFE_PUSH_LONG = /^--(?:force(?:-with-lease|-if-includes)?|delete|mirror|prune)(?:=|$)/;
const UNSAFE_PUSH_SHORT = /[fd]/;

// 절대 규칙: 커밋 메시지에 Claude 작성 표기를 남기지 않는다. 표준 footer 형태만 잡는다 —
// 단순 "claude" 단어는 정상 메시지에 나올 수 있으므로 표기 패턴만 차단한다(오탐 방지).
export const CLAUDE_ATTRIBUTION =
  /co-authored-by:[^\n]*\bclaude\b|generated with[^\n]*\bclaude\b|\bclaude-session:|noreply@anthropic\.com/i;

export const isGitMutation = (command) => {
  if (GIT_MUTATION.test(command)) return true;
  return [...command.matchAll(GIT_SWITCH)].some((switchMatch) =>
    isDestructiveSwitchTail(switchMatch[1]),
  );
};

// 판정 결과를 사유와 함께 돌려준다 — CLI가 사유별 안내 메시지를 낸다.
// rule: 'mutation' | 'attribution' | 'commit-flags' | 'push-flags'
export const judgeGitCommand = (command, { allowCommitPush = false } = {}) => {
  if (!allowCommitPush) {
    return isGitMutation(command) ? { blocked: true, rule: 'mutation' } : { blocked: false };
  }
  if (GIT_MUTATION_EXCEPT_COMMIT_PUSH.test(command)) return { blocked: true, rule: 'mutation' };
  if ([...command.matchAll(GIT_SWITCH)].some((m) => isDestructiveSwitchTail(m[1]))) {
    return { blocked: true, rule: 'mutation' };
  }
  const commits = [...command.matchAll(GIT_COMMIT)];
  if (commits.length > 0) {
    // 표기 검사는 명령 전체를 본다 — heredoc 메시지 본문은 개행을 포함해 꼬리 캡처 밖에 있다.
    if (CLAUDE_ATTRIBUTION.test(command)) return { blocked: true, rule: 'attribution' };
    if (commits.some((m) => tailHasFlag(m[1], UNSAFE_COMMIT_LONG, UNSAFE_COMMIT_SHORT))) {
      return { blocked: true, rule: 'commit-flags' };
    }
  }
  if ([...command.matchAll(GIT_PUSH)].some((m) => tailHasFlag(m[1], UNSAFE_PUSH_LONG, UNSAFE_PUSH_SHORT))) {
    return { blocked: true, rule: 'push-flags' };
  }
  return { blocked: false };
};

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const { tool_input } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const command = tool_input?.command ?? '';

  const configPath = join(dirname(fileURLToPath(import.meta.url)), 'blockGitMutation.config.json');
  let allowCommitPush = false;
  let configNote = '';
  if (existsSync(configPath)) {
    try {
      allowCommitPush = JSON.parse(readFileSync(configPath, 'utf8')).allowCommitPush === true;
    } catch (error) {
      // 가드 훅은 설정 오류에 fail-closed — 예외를 끄고 기본 차단으로 동작한다.
      configNote = ` (blockGitMutation.config.json 파싱 실패: ${error.message} — commit·push 예외 비활성)`;
    }
  }

  const verdict = judgeGitCommand(command, { allowCommitPush });
  if (verdict.blocked) {
    const messages = {
      mutation: allowCommitPush
        ? 'commit·push 외의 git 변경 작업(merge·rebase·reset·checkout 등)은 여전히 사용자 전담입니다. 변경 요약을 보고하고 사용자에게 안내하세요.'
        : 'git 변경 작업은 사용자 전담입니다. 변경 요약을 보고하고 "커밋은 직접 진행하세요"로 안내하세요. ' +
          '브랜치 전환이 필요하면 branch 스킬로 사용자 확인 후 git switch(-c)를 사용하세요 — force/discard 플래그는 허용되지 않습니다. ' +
          '사용자가 커밋·PR 업로드를 명시 요청했다면 pr 스킬을 따르세요 — blockGitMutation.config.json의 allowCommitPush 옵트인이 필요합니다.',
      attribution:
        '커밋 메시지에 Claude 작성 표기(Co-Authored-By: Claude·Generated with Claude Code·Claude-Session 등)가 있습니다. ' +
        '절대 규칙: 표기를 전부 제거한 메시지로 다시 커밋하세요 (pr 스킬).',
      'commit-flags':
        '메시지를 검사할 수 없는 커밋 형태입니다. --amend와 -F/-t/-c/-C/--fixup/--squash는 허용되지 않습니다 — 메시지는 -m으로 인라인 작성하세요.',
      'push-flags':
        'force/delete push는 허용되지 않습니다 — 일반 push(-u 포함)만 가능합니다. 히스토리 재작성·원격 브랜치 삭제가 필요하면 사용자에게 안내하세요.',
    };
    console.error(`차단됨: ${messages[verdict.rule]}${configNote}`);
    process.exit(2);
  }
}
