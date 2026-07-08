#!/usr/bin/env node
// 다이제스트 신선도 검사기 — 소스 파일의 내용 해시로 다이제스트 유효성을 판정한다.
// mtime이 아니라 내용 해시를 쓴다: 체크아웃·복사는 mtime을 바꾸지만 내용은 그대로다.
//
// 사용법:
//   node checkFreshness.mjs hash <파일...>                      소스별 해시 출력 (frontmatter 기록용)
//   node checkFreshness.mjs check <다이제스트.md> [--root <경로>]  전 소스 fresh/stale/missing 판정
//
// check 종료 코드: 0 = 전부 fresh, 1 = stale/missing 존재 또는 sources 파싱 실패

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const HASH_LENGTH = 12;

export const hashContent = ({ content }) =>
  createHash('sha256').update(content).digest('hex').slice(0, HASH_LENGTH);

const hashFile = async ({ path }) => {
  try {
    return hashContent({ content: await readFile(path) });
  } catch {
    return null; // 읽기 실패 = 소스 삭제/이동 → missing
  }
};

// frontmatter의 sources 목록(`- path:` / `hash:` 쌍)을 파싱한다.
// frontmatter는 파일 첫 줄에서 시작해야 한다 (digest 템플릿 형식).
export const parseSources = ({ content }) => {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const sources = [];
  let current = null;
  for (const line of match[1].split('\n')) {
    const pathMatch = line.match(/^\s*-\s+path:\s*(.+)$/);
    const hashMatch = line.match(/^\s+hash:\s*(\S+)/);
    if (pathMatch) {
      current = { path: pathMatch[1].trim().replace(/^["']|["']$/g, ''), hash: null };
      sources.push(current);
    } else if (hashMatch && current) {
      current.hash = hashMatch[1];
    }
  }
  return sources;
};

export const checkFreshness = async ({ digestPath, rootDir }) => {
  const content = await readFile(digestPath, 'utf8');
  const sources = parseSources({ content });
  if (!sources || sources.length === 0) {
    return {
      ok: false,
      results: [],
      error: 'frontmatter에 sources 목록이 없다 — docs/templates/digest.md 형식을 확인하라',
    };
  }
  const results = [];
  for (const source of sources) {
    const absolutePath = isAbsolute(source.path) ? source.path : join(rootDir, source.path);
    const actualHash = await hashFile({ path: absolutePath });
    const status =
      actualHash === null ? 'missing' : actualHash === source.hash ? 'fresh' : 'stale';
    results.push({ path: source.path, recorded: source.hash, actual: actualHash, status });
  }
  return { ok: results.every((result) => result.status === 'fresh'), results };
};

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const [command, ...rest] = process.argv.slice(2);

  if (command === 'hash' && rest.length > 0) {
    for (const filePath of rest) {
      const hash = await hashFile({ path: filePath });
      if (hash === null) {
        console.error(`[error] ${filePath}: 읽을 수 없다`);
        process.exitCode = 1;
      } else {
        console.log(`${hash}  ${filePath}`);
      }
    }
  } else if (command === 'check' && rest.length > 0) {
    // --root <값> 쌍을 위치 인자에서 분리한다. splice 방식이라 --root가 없을 때(indexOf -1)
    // 위치 인자가 오염되지 않는다 — 필터+인덱스 산술은 -1+1=0으로 다이제스트 경로를 지웠다.
    const positional = [...rest];
    let rootDir = process.cwd();
    const rootFlagIndex = positional.indexOf('--root');
    if (rootFlagIndex !== -1) {
      const [, rootValue] = positional.splice(rootFlagIndex, 2);
      if (rootValue == null) {
        console.error('[error] --root 뒤에 프로젝트 루트 경로가 필요하다');
        process.exit(1);
      }
      rootDir = rootValue;
    }
    const digestPath = positional[0];
    if (!digestPath) {
      console.error('[error] 검사할 다이제스트 파일 경로가 필요하다');
      process.exit(1);
    }
    const { ok, results, error } = await checkFreshness({ digestPath, rootDir });
    if (error) {
      console.error(`[error] ${digestPath}: ${error}`);
    }
    for (const result of results) {
      console.log(`[${result.status}] ${result.path} (기록 ${result.recorded ?? '-'} / 현재 ${result.actual ?? '-'})`);
    }
    console.log(ok ? '\n판정: fresh — 다이제스트만 읽고 진행 가능' : '\n판정: 갱신 필요 — stale/missing 소스만 다시 읽고 다이제스트를 갱신하라');
    process.exitCode = ok ? 0 : 1;
  } else {
    console.error('사용법: checkFreshness.mjs hash <파일...> | check <다이제스트.md> [--root <경로>]');
    process.exitCode = 1;
  }
}
