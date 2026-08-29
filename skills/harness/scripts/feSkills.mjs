#!/usr/bin/env node
// fe-skills 라이브러리 클라이언트 — 플러그인 설치 없이 필요한 스킬만 가져온다.
//
// Guksu/fe-skills는 UI 패턴 29종(fe-ui)과 화면 설계 판정 2종(fe-system)의 정본이다.
// 플러그인으로 설치하면 description 31개가 모든 프로젝트의 모든 턴에 상시 로딩되므로,
// 대신 이 스크립트로 목록을 조회하고 필요한 하나만 읽어 온다(상시 로딩 비용 0).
//
// 사용법:
//   node feSkills.mjs list [--json]              전체 목록 (slug · 플러그인 · 설명)
//   node feSkills.mjs find <검색어...>            요청에 맞는 스킬 후보를 순위대로
//   node feSkills.mjs get <slug> [--into <dir>]  SKILL.md 경로 출력 + 정본 코드 복사
//   공통 옵션: --refresh(캐시 강제 갱신) --cache <dir>(캐시 위치 지정)
//
// 캐시는 얕은 클론이다($XDG_CACHE_HOME/guksu-harness/fe-skills). 네트워크가 없고 캐시도
// 없으면 exit 3으로 알리고 끝낸다 — 라이브러리를 못 써도 작업 자체는 계속되어야 하므로,
// 호출하는 쪽은 이 실패를 "직접 구현"으로 넘어가는 신호로만 쓴다.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, copyFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_URL = 'https://github.com/Guksu/fe-skills';
// 플러그인별 정본 위치와 스킬에 딸린 파일 디렉토리. ui는 실행 가능한 코드(assets),
// system은 판정 근거 문서(references)를 갖는다.
export const PLUGINS = [
  { plugin: 'fe-ui', dir: 'plugins/ui/skills', payload: 'assets' },
  { plugin: 'fe-system', dir: 'plugins/system/skills', payload: 'references' },
];

export const parseFrontmatter = (content) => {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fields = {};
  let currentKey = null;
  for (const line of match[1].split('\n')) {
    const fieldMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (fieldMatch) {
      currentKey = fieldMatch[1];
      fields[currentKey] = fieldMatch[2].trim();
    } else if (currentKey && /^\s+\S/.test(line)) {
      fields[currentKey] = [fields[currentKey], line.trim()].filter(Boolean).join(' ');
    }
  }
  // 따옴표는 값을 다 이어붙인 뒤에 벗긴다 — 줄마다 벗기면 멀티라인 값의 닫는 따옴표가 남는다.
  for (const [key, value] of Object.entries(fields)) {
    fields[key] = value.replace(/^(["'])([\s\S]*)\1$/, '$2');
  }
  return fields;
};

// 검색어와 카탈로그 항목의 관련도. 한글·영문을 함께 다루므로 토큰 분리에 더해
// 부분 문자열도 본다 — "바텀시트로 메뉴"의 "바텀시트로"는 토큰이 달라도 매칭돼야 한다.
const tokenize = (text) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

export const scoreEntry = (entry, query) => {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;
  const slug = entry.slug.toLowerCase();
  const slugWords = tokenize(entry.slug);
  const haystack = `${entry.slug} ${entry.description}`.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    // slug 정확 일치가 가장 강한 신호 — 사용자가 이름을 알고 부른 경우다
    if (slug === token) score += 100;
    else if (slugWords.includes(token)) score += 20;
    if (haystack.includes(token)) score += 10;
    // 조사가 붙은 한글("바텀시트로")은 토큰이 달라 위에서 못 잡는다 — 역방향 포함을 본다
    else if (token.length >= 3 && [...haystack.matchAll(/[\p{L}\p{N}]+/gu)]
      .some(([word]) => token.includes(word) && word.length >= 3)) score += 6;
  }
  return score;
};

export const rankCandidates = ({ catalog, query, limit = 5 }) =>
  catalog
    .map((entry) => ({ ...entry, score: scoreEntry(entry, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .slice(0, limit);

// 캐시(클론) 디렉토리에서 카탈로그를 만든다. 스킬 하나가 깨져 있어도 나머지는 살린다.
export const buildCatalog = ({ rootDir }) => {
  const catalog = [];
  for (const { plugin, dir, payload } of PLUGINS) {
    const skillsDir = join(rootDir, dir);
    if (!existsSync(skillsDir)) continue;
    for (const name of readdirSync(skillsDir).sort()) {
      const skillPath = join(skillsDir, name, 'SKILL.md');
      if (!existsSync(skillPath)) continue;
      const frontmatter = parseFrontmatter(readFileSync(skillPath, 'utf8'));
      if (!frontmatter?.description) continue;
      catalog.push({
        slug: name,
        plugin,
        description: frontmatter.description,
        skillPath,
        payloadDir: join(skillsDir, name, payload),
        payload,
      });
    }
  }
  return catalog;
};

const defaultCacheDir = () =>
  join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'guksu-harness', 'fe-skills');

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// 캐시를 준비한다. 실패해도 기존 캐시가 있으면 그것으로 진행한다 — 낡은 라이브러리가
// 없는 라이브러리보다 낫다(정본 코드는 자주 바뀌지 않는다). 둘 다 없을 때만 실패다.
export const ensureCache = ({ cacheDir, refresh = false, cloneFn, log = () => {} }) => {
  const cloned = existsSync(join(cacheDir, '.git'));
  if (cloned && !refresh) return { ok: true, cacheDir, fresh: false };
  try {
    cloneFn ? cloneFn({ cacheDir, cloned }) : defaultClone({ cacheDir, cloned });
    return { ok: true, cacheDir, fresh: true };
  } catch (error) {
    if (cloned) {
      log(`경고: fe-skills 캐시 갱신 실패 — 기존 캐시로 진행한다 (${error.message.trim().split('\n')[0]})`);
      return { ok: true, cacheDir, fresh: false, stale: true };
    }
    return { ok: false, error };
  }
};

const defaultClone = ({ cacheDir, cloned }) => {
  if (cloned) {
    git(['fetch', '--depth', '1', 'origin', 'HEAD'], cacheDir);
    git(['reset', '--hard', 'FETCH_HEAD'], cacheDir);
    return;
  }
  mkdirSync(cacheDir, { recursive: true });
  git(['clone', '--depth', '1', REPO_URL, cacheDir]);
};

// 정본 파일을 대상 디렉토리로 복사한다. 덮어쓰기 전에 기존 파일을 보고한다 —
// 프로젝트에 이미 손댄 사본이 있으면 조용히 지우지 않는다.
export const copyPayload = ({ payloadDir, into }) => {
  if (!existsSync(payloadDir)) return { copied: [], overwritten: [] };
  mkdirSync(into, { recursive: true });
  const copied = [];
  const overwritten = [];
  for (const name of readdirSync(payloadDir).sort()) {
    const from = join(payloadDir, name);
    if (!statSync(from).isFile()) continue;
    const to = join(into, name);
    if (existsSync(to)) overwritten.push(to);
    copyFileSync(from, to);
    copied.push(to);
  }
  return { copied, overwritten };
};

const isDirectRun =
  process.argv[1] != null && basename(process.argv[1]) === basename(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const index = argv.indexOf(name);
    if (index === -1) return null;
    return argv[index + 1] ?? null;
  };
  const command = argv[0];
  const refresh = argv.includes('--refresh');
  const cacheDir = flag('--cache') ?? defaultCacheDir();

  const ready = ensureCache({ cacheDir, refresh, log: (m) => console.error(m) });
  if (!ready.ok) {
    console.error(
      `fe-skills 라이브러리를 가져오지 못했다(${REPO_URL}). 네트워크를 확인하거나, ` +
        '이번 작업은 라이브러리 없이 직접 구현하고 그 사실을 작업 기록에 남겨라.',
    );
    process.exit(3);
  }
  const catalog = buildCatalog({ rootDir: cacheDir });

  if (command === 'list') {
    if (argv.includes('--json')) {
      console.log(JSON.stringify(catalog.map(({ slug, plugin, description }) => ({ slug, plugin, description })), null, 2));
    } else {
      for (const entry of catalog) {
        console.log(`${entry.slug}\t[${entry.plugin}]\t${entry.description.split('.')[0]}.`);
      }
      console.log(`\n총 ${catalog.length}종. 상세는 get <slug>.`);
    }
  } else if (command === 'find') {
    const query = argv.slice(1).filter((a) => !a.startsWith('--') && a !== cacheDir).join(' ');
    const matches = rankCandidates({ catalog, query });
    if (matches.length === 0) {
      console.log(`"${query}"에 맞는 스킬이 없다 — 이 패턴은 직접 구현하고 작업 기록에 남겨라.`);
      process.exit(0);
    }
    for (const entry of matches) {
      console.log(`${entry.slug}\t[${entry.plugin}]\t${entry.description.split('.')[0]}.`);
    }
    console.log(`\n가져오려면: get ${matches[0].slug} --into <대상 디렉토리>`);
  } else if (command === 'get') {
    const slug = argv[1];
    const entry = catalog.find((candidate) => candidate.slug === slug);
    if (!entry) {
      console.error(`"${slug}"는 fe-skills에 없다. list 또는 find로 확인하라.`);
      process.exit(1);
    }
    console.log(`SKILL.md: ${entry.skillPath}`);
    console.log('  ↑ 이 파일을 읽고 "언제 쓰는가 · 왜 이 기술인가 · 사용법 · 주의사항"을 따른다.');
    const into = flag('--into');
    if (into) {
      const { copied, overwritten } = copyPayload({ payloadDir: entry.payloadDir, into });
      for (const path of copied) console.log(`복사: ${path}`);
      if (overwritten.length > 0) {
        console.log(`\n덮어쓴 파일 ${overwritten.length}건 — 프로젝트에서 수정한 사본이었다면 diff를 확인하라.`);
      }
      console.log(`\n출처: ${REPO_URL} (${entry.plugin}/${slug}, MIT). 작업 기록에 출처를 남긴다.`);
    } else if (existsSync(entry.payloadDir)) {
      console.log(`${entry.payload}/: ${entry.payloadDir}`);
      console.log('  ↑ --into <대상 디렉토리>로 프로젝트에 복사할 수 있다.');
    }
  } else {
    console.error('사용법: feSkills.mjs list|find|get [인자] [--refresh] [--cache <dir>]');
    process.exit(1);
  }
}
