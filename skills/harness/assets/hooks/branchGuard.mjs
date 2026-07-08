#!/usr/bin/env node
// PreToolUse 훅 (matcher: Edit|Write|NotebookEdit) — 보호 브랜치(main 등) 위에서의 파일 편집을 차단한다.
// "작업 시작 전에 작업 브랜치부터 확인"을 기계적으로 강제한다 — branch 스킬과 한 쌍으로 동작한다.
// exit 2면 호출이 차단되고 stderr가 에이전트에게 피드백으로 전달된다.
//
// 설정 파일(스크립트 옆 branchGuard.config.json):
//   { "protectedBranches": ["main", "master"] }
// 설정 파일이 없으면 기본값(main·master)으로 동작한다.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PROTECTED_BRANCHES = ['main', 'master'];

// .git/HEAD를 직접 읽는다 — git 서브프로세스 없이 결정적이고 빠르다.
// .git이 파일이면(worktree·서브모듈) gitdir 포인터를 따라간다.
// detached HEAD·git 저장소 아님 → null (가드 비활성 — 무해).
export const readCurrentBranch = ({ projectDir }) => {
  try {
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

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));

  const hookDir = dirname(fileURLToPath(import.meta.url));
  const configPath = join(hookDir, 'branchGuard.config.json');
  let protectedBranches = DEFAULT_PROTECTED_BRANCHES;
  if (existsSync(configPath)) {
    try {
      protectedBranches =
        JSON.parse(readFileSync(configPath, 'utf8')).protectedBranches ??
        DEFAULT_PROTECTED_BRANCHES;
    } catch (error) {
      // 가드 훅은 설정 오류에 fail-closed — 파싱 예외로 조용히 죽으면(exit≠2는 비차단)
      // 사용자가 설정을 만지려던 순간 보호가 사라진 걸 아무도 모른다.
      console.error(
        `차단됨: branchGuard.config.json 파싱 실패(${error.message}) — 설정 파일을 고치기 전까지 파일 편집을 차단합니다.`,
      );
      process.exit(2);
    }
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  const branch = readCurrentBranch({ projectDir });
  if (isProtectedBranch({ branch, protectedBranches })) {
    console.error(
      `차단됨: 보호 브랜치(${branch}) 위에서는 파일을 편집하지 않습니다. ` +
        'branch 스킬로 작업 브랜치를 사용자에게 확인받으세요 — 승인 후 git switch -c <이름>(신규) 또는 git switch <이름>(기존)으로 이동한 뒤 편집을 재시도합니다. ' +
        '보호 브랜치에서 계속하려면 사용자가 직접 branchGuard.config.json의 protectedBranches를 수정해야 합니다.',
    );
    process.exit(2);
  }
}
