#!/usr/bin/env node
// PreToolUse 훅 — 보호 브랜치(main 등) 위에서의 파일 편집을 차단한다.
//   matcher: Claude Code는 Edit|Write|NotebookEdit|Bash, Codex는 apply_patch|Edit|Write|Bash (편집 도구 이름이 다르다).
// 편집 도구는 항상 막는다. Bash는 추적 중인 파일을 제자리에서 고치는 흔한 형태만 막는다:
//   sed -i · perl -i · tee · > >> 리다이렉션 · rm · mv · cp(대상). 그 밖의 Bash 명령은 통과한다.
//   스크립트 안의 쓰기(python·node -e)와 새 파일 생성은 보지 못한다 — 셸 파서를 대신하지 않는다.
// "작업 시작 전에 작업 브랜치부터 확인"을 기계적으로 강제한다 — branch 스킬과 한 쌍으로 동작한다.
// exit 2면 호출이 차단되고 stderr가 에이전트에게 피드백으로 전달된다.
//
// 설정 파일(스크립트 옆 branchGuard.config.json):
//   { "protectedBranches": ["main", "master"] }
// 설정 파일이 없으면 기본값(main·master)으로 동작한다.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PROTECTED_BRANCHES = ['main', 'master'];

// .git/HEAD를 직접 읽는다 — git 서브프로세스 없이 결정적이고 빠르다.
// .git이 파일이면(worktree·서브모듈) gitdir 포인터를 따라간다.
// detached HEAD·git 저장소 아님 → null (가드 비활성 — 무해).
export const readCurrentBranch = ({ projectDir }) => {
  try {
    projectDir = realpathSync(projectDir);
    while (!existsSync(join(projectDir, '.git'))) {
      const parent = dirname(projectDir);
      if (parent === projectDir) return null;
      projectDir = parent;
    }
    const gitPath = join(projectDir, '.git');
    let headPath = join(gitPath, 'HEAD');
    if (!existsSync(headPath)) {
      const pointer = readFileSync(gitPath, 'utf8').match(/^gitdir:\s*(.+)$/m);
      if (!pointer) return null;
      headPath = join(resolve(projectDir, pointer[1].trim()), 'HEAD');
    }
    const refMatch = readFileSync(headPath, 'utf8')
      .trim()
      .match(/^ref:\s*refs\/heads\/(.+)$/);
    return refMatch ? refMatch[1] : null;
  } catch {
    return null;
  }
};

export const isProtectedBranch = ({ branch, protectedBranches }) =>
  branch != null && protectedBranches.includes(branch);

// Bash 명령이 제자리에서 고치거나 지우는 경로 후보를 뽑는다. 각 항목은 { cwd, path }다.
// `cd 하위 && sed -i …`처럼 앞에서 옮긴 디렉터리를 따라간다. 후보가 실제 추적 파일인지는 trackedWriteTargets가 확인한다.
const unquote = (token) => token.replace(/^(['"])(.*)\1$/, '$2');
const IN_PLACE = { sed: /^(?:-[A-Za-z]*i|--in-place)/, perl: /^-[A-Za-z0-9]*i/ };
export function bashWriteTargets(command, cwd = '.') {
  const targets = [];
  let dir = cwd;
  for (const segment of command.split(/[;|&\n]+/)) {
    for (const match of segment.matchAll(/(?<![0-9&>])>>?\s*(?!&)("[^"]+"|'[^']+'|[^\s<>()]+)/g)) targets.push({ cwd: dir, path: unquote(match[1]) });
    const tokens = segment.replace(/(?<![0-9&>])>>?\s*(?!&)("[^"]+"|'[^']+'|[^\s<>()]+)/g, ' ').trim().split(/\s+/).filter(Boolean).map(unquote);
    while (tokens.length > 1 && /^\w+=/.test(tokens[0])) tokens.shift();
    const [name, ...rest] = tokens;
    const args = rest.filter((token) => !token.startsWith('-'));
    if (name === 'cd' && args.length === 1) dir = resolve(dir, args[0]);
    else if (IN_PLACE[name] && rest.some((token) => IN_PLACE[name].test(token))) targets.push(...args.map((path) => ({ cwd: dir, path })));
    else if (name === 'tee' || name === 'rm' || name === 'mv') targets.push(...args.map((path) => ({ cwd: dir, path })));
    else if (name === 'cp' && args.length > 1) targets.push({ cwd: dir, path: args.at(-1) });
  }
  return targets.filter((target) => target.path && !target.path.startsWith('/dev/') && !/[$`*?]/.test(target.path));
}

// 후보 가운데 Git이 추적하는 파일만 남긴다(최대 8개 확인). Git을 실행할 수 없으면 빈 목록 — 이 검사는 실수 방지용이다.
export function trackedWriteTargets(command, cwd) {
  const tracked = [];
  for (const target of bashWriteTargets(command, cwd).slice(0, 8)) {
    const result = spawnSync('git', ['ls-files', '--error-unmatch', '--', target.path], { cwd: target.cwd, stdio: 'ignore', timeout: 5000 });
    if (result.status === 0 && !tracked.includes(target.path)) tracked.push(target.path);
  }
  return tracked;
}

// 심링크 경로 호출 시 ESM URL(realpath) ↔ argv[1](원문) 불일치로 fail-open이 되지 않게
// 양쪽을 realpath로 정규화해 비교한다.
const toRealPath = (p) => { try { return realpathSync(p); } catch { return p; } };
const isDirectRun = process.argv[1] != null
  && toRealPath(process.argv[1]) === toRealPath(fileURLToPath(import.meta.url));
if (isDirectRun) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));

  const bashCommand = typeof input.tool_input?.command === 'string' ? input.tool_input.command : null;
  const hookDir = dirname(fileURLToPath(import.meta.url));
  const configPath = join(hookDir, 'branchGuard.config.json');
  let protectedBranches = DEFAULT_PROTECTED_BRANCHES;
  if (existsSync(configPath)) {
    try {
      protectedBranches =
        JSON.parse(readFileSync(configPath, 'utf8')).protectedBranches ??
        DEFAULT_PROTECTED_BRANCHES;
      if (!Array.isArray(protectedBranches) || protectedBranches.some(branch => typeof branch !== 'string' || !branch.trim())) {
        throw new Error('protectedBranches는 브랜치 이름의 배열이어야 합니다');
      }
    } catch (error) {
      // Bash까지 막으면 설정을 고칠 방법이 없다. 편집 도구만 막고 Bash는 통과시킨다.
      if (bashCommand != null) process.exit(0);
      // 가드 훅은 설정 오류에 fail-closed — 파싱 예외로 조용히 죽으면(exit≠2는 비차단)
      // 사용자가 설정을 만지려던 순간 보호가 사라진 걸 아무도 모른다.
      console.error(
        `차단됨: branchGuard.config.json 파싱 실패(${error.message}) — 설정 파일을 고치기 전까지 파일 편집을 차단합니다.`,
      );
      process.exit(2);
    }
  }

  // 프로젝트 경로: 훅 입력의 cwd가 우선이다. CLAUDE_PROJECT_DIR는 Claude Code만 준다.
  const projectDir = input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const branch = readCurrentBranch({ projectDir });
  if (isProtectedBranch({ branch, protectedBranches })) {
    let subject = '파일을 편집하지 않습니다';
    if (bashCommand != null) {
      const files = trackedWriteTargets(bashCommand, projectDir);
      if (!files.length) process.exit(0);
      subject = `추적 중인 파일(${files.slice(0, 3).join(', ')})을 셸 명령으로 고치지 않습니다`;
    }
    console.error(
      `차단됨: 보호 브랜치(${branch}) 위에서는 ${subject}. ` +
        '요청된 구현 범위에서 프로젝트 관례에 맞는 작업 브랜치로 이동한 뒤 재시도하세요(git switch -c <이름>은 진행 중인 변경을 그대로 가져갑니다). 이미 승인된 브랜치 준비는 다시 확인하지 않습니다. ' +
        '보호 브랜치에서 계속하려면 사용자가 직접 branchGuard.config.json의 protectedBranches를 수정해야 합니다.',
    );
    process.exit(2);
  }
}
