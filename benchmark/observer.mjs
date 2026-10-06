// 벤치마크 전용 수동 관찰 훅. 모든 구성에 같은 --settings로 등록하며, 어떤 호출도 막거나 바꾸지 않는다.
// 사용: node observer.mjs <events.jsonl>  (stdin: 앱의 훅 입력 JSON)
// 출력하지 않고 항상 종료 코드 0으로 끝난다. 도구 출력(tool_response)은 저장하지 않는다.
import { appendFileSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 호출 시점의 브랜치. .git이 파일이면(worktree) gitdir을 따라간다. detached HEAD는 커밋 해시 앞부분.
export function readBranch(start) {
  try {
    let dir = resolve(start);
    while (!existsSync(join(dir, '.git'))) {
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
    let gitDir = join(dir, '.git');
    if (!existsSync(join(gitDir, 'HEAD'))) {
      const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitDir, 'utf8'));
      if (!pointer) return null;
      gitDir = resolve(dir, pointer[1].trim());
    }
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
    return /^ref:\s*refs\/heads\/(.+)$/.exec(head)?.[1] ?? `detached:${head.slice(0, 12)}`;
  } catch {
    return null;
  }
}

export function toRecord(input, at = new Date().toISOString()) {
  const toolInput = input.tool_input ?? {};
  const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : null);
  return {
    at,
    event: input.hook_event_name ?? null,
    tool: input.tool_name ?? null,
    id: input.tool_use_id ?? null,
    branch: input.cwd ? readBranch(input.cwd) : null,
    cwd: input.cwd ?? null,
    command: text(toolInput.command, 4000),
    path: text(toolInput.file_path ?? toolInput.notebook_path ?? toolInput.path, 1000),
    skill: text(toolInput.skill ?? toolInput.command_name, 200),
    permissionMode: input.permission_mode ?? null,
  };
}

const toRealPath = (path) => { try { return realpathSync(path); } catch { return path; } };
const isDirectRun = process.argv[1] != null && toRealPath(process.argv[1]) === toRealPath(fileURLToPath(import.meta.url));
if (isDirectRun && process.argv[2]) {
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    appendFileSync(process.argv[2], `${JSON.stringify(toRecord(input))}\n`);
  } catch {
    // 관찰 실패가 에이전트의 작업을 바꾸면 안 된다. 기록 누락은 채점에서 미측정으로 처리한다.
  }
}
