#!/usr/bin/env node
// PreToolUse 훅 — 시크릿 파일의 내용을 읽는 도구 호출을 차단한다.
//   matcher: Claude Code는 Bash|Read|Grep, Codex는 Bash.
// 검사하는 것:
//   1. 셸 명령이 시크릿 파일을 가리킨다 (`cat .env`, `grep KEY .env`).
//   2. 재귀 검색이 시크릿 파일을 훑는다 (`grep -rn KEY .` — .gitignore를 무시하고 .env 줄을 출력한다).
//   3. Read·Grep 도구가 시크릿 파일을 직접 연다.
// 내용을 읽지 않는 명령(ls·test·stat·touch·echo·git status 등)과 검색 제외 옵션(--exclude=.env)은 허용한다.
// 셸 파서 전체를 대신하지 않는다 — 변수·명령 치환으로 만든 경로, 스크립트 안의 읽기는 보지 못한다.
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 시크릿이 아닌 관례적 예시 파일(.env.example 등)은 허용한다.
const ENV_EXAMPLE = /\.(?:example|sample|template|dist)(?:\.|$)/;

// 경로 하나가 시크릿 파일을 가리키는가. `.env*`·`.env.*` 같은 glob도 시크릿으로 본다.
export const isSecretPath = (value) => {
  const path = String(value ?? '').replace(/\\/g, '/');
  if (/(?:^|\/)secrets\//.test(path)) return true;
  const base = path.split('/').pop() ?? '';
  if (/^\.env(?:[.*?[].*)?$/.test(base)) return !ENV_EXAMPLE.test(base);
  return /^credentials/i.test(base) || /\.pem$/.test(base);
};

// 명령을 구분자로 나누고 토큰으로 쪼갠다. `--exclude='.env*'`처럼 따옴표로 갈린 `옵션=` 뒤의 값은 다시 붙인다.
const segmentsOf = (command) => command.split(/[;|&()`\n]+/).map((part) => {
  const tokens = [];
  for (const token of part.split(/[\s<>'"]+/).filter(Boolean)) {
    if (tokens.length && /^--[\w-]+=$/.test(tokens.at(-1))) tokens[tokens.length - 1] += token;
    else tokens.push(token);
  }
  return tokens;
}).filter((tokens) => tokens.length);
const valueOf = (token) => token.replace(/^[\w-]+=/, ''); // FOO=./key.pem, --file=.env 형태의 값 추출
const stripAssignments = (tokens) => { let i = 0; while (i < tokens.length - 1 && /^\w+=/.test(tokens[i])) i++; return tokens.slice(i); };
const expandBraces = (value) => { const m = value.match(/^(.*)\{([^{}]*)\}(.*)$/); return m ? m[2].split(',').map((item) => `${m[1]}${item}${m[3]}`) : [value]; };

// 파일 내용을 출력하지 않는 명령. 존재 확인·권한·.gitignore 추가 같은 준비 작업을 막지 않는다.
const NO_READ = new Set(['ls', 'test', '[', '[[', 'stat', 'touch', 'echo', 'printf']);
const GIT_NO_READ = new Set(['check-ignore', 'ls-files', 'status']);
const EXCLUDE_FLAG = /^--(?:exclude|exclude-dir|exclude-from|ignore)$/;
const EXCLUDE_VALUE = /^--(?:exclude|exclude-dir|exclude-from|ignore)=/;

function segmentReferencesSecret(rawTokens) {
  const [command, subcommand] = stripAssignments(rawTokens);
  if (NO_READ.has(command) || (command === 'git' && GIT_NO_READ.has(subcommand))) return false;
  const tokens = rawTokens; // 앞에 붙은 FOO=./key.pem 같은 대입도 경로로 검사한다
  const args = tokens.filter((token, index) => {
    if (EXCLUDE_VALUE.test(token) || /^--i?glob=!/.test(token)) return false; // 검색에서 빼는 옵션은 접근이 아니다
    if (token.startsWith('!') && token.length > 1) return false; // rg -g '!.env'
    return !(index > 0 && EXCLUDE_FLAG.test(tokens[index - 1]));
  });
  // 예시 파일을 실제 파일로 복사하는 준비 작업(`cp .env.example .env`)은 내용을 출력하지 않는다.
  if (command === 'cp' && !args.slice(0, -1).some((token) => isSecretPath(valueOf(token)))) return false;
  return args.some((token) => isSecretPath(valueOf(token)));
}

// 명령이 시크릿 파일을 직접 가리키는가.
export const referencesSecret = (command) => segmentsOf(command).some(segmentReferencesSecret);

// ── 재귀 검색 ────────────────────────────────────────────────────────────────
const globRegex = (glob) => {
  const body = glob.replace(/[.+^$(){}|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + body + '$');
};
const matchesAny = (name, globs) => globs.some((glob) => { try { return globRegex(glob.replace(/^.*\//, '') || glob).test(name); } catch { return false; } });

function searchSpec(rawTokens) {
  const tokens = stripAssignments(rawTokens);
  const command = tokens[0];
  const flags = tokens.filter((token) => token.startsWith('-'));
  const shortFlags = flags.filter((token) => !token.startsWith('--')).map((token) => token.slice(1));
  let recursive = false;
  if (/^(?:e|f)?grep$/.test(command)) recursive = flags.some((flag) => /^--(?:dereference-)?recursive$/.test(flag)) || shortFlags.some((flag) => /^[A-Za-z]*[rR]/.test(flag));
  // rg는 숨김 파일을 건너뛴다. --hidden·-.·-uu일 때만 .env에 닿는다.
  else if (command === 'rg') recursive = flags.some((flag) => flag === '--hidden' || flag === '-.') || shortFlags.join('').split('u').length > 2;
  if (!recursive) return null;
  const excludes = [], excludeDirs = [], includes = [];
  let typed = false;
  tokens.forEach((token, index) => {
    const next = tokens[index + 1] ?? '';
    const push = (list, value) => list.push(...expandBraces(value.replace(/^!/, '')));
    if (/^--exclude=/.test(token)) push(excludes, valueOf(token));
    else if (token === '--exclude') push(excludes, next);
    else if (/^--exclude-dir=/.test(token)) push(excludeDirs, valueOf(token));
    else if (token === '--exclude-dir') push(excludeDirs, next);
    else if (/^--include=/.test(token)) push(includes, valueOf(token));
    else if (token === '--include') push(includes, next);
    else if (/^--i?glob=/.test(token)) push(valueOf(token).startsWith('!') ? excludes : includes, valueOf(token));
    else if (/^(?:-g|--i?glob)$/.test(token)) push(next.startsWith('!') ? excludes : includes, next);
    else if (/^(?:-t|--type)/.test(token)) typed = true;
  });
  const hasPatternFlag = flags.some((flag) => /^(?:-[A-Za-z]*[ef]|--regexp|--file)$/.test(flag) || /^--(?:regexp|file)=/.test(flag));
  const positional = tokens.slice(1).filter((token) => !token.startsWith('-') && !token.startsWith('!'));
  return { command, excludes, excludeDirs, includes, typed, paths: positional.slice(hasPatternFlag ? 0 : 1) };
}

// 검색 대상 디렉터리에서 시크릿 파일을 찾는다. 깊이·항목 수를 제한해 훅이 느려지지 않게 한다.
function findSecrets(dir, spec, depth, budget, found, label) {
  if (depth > 3 || budget.left <= 0 || found.length >= 3) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (--budget.left <= 0 || found.length >= 3) return;
    const shown = label ? `${label}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules' || matchesAny(entry.name, spec.excludeDirs)) continue;
      findSecrets(join(dir, entry.name), spec, depth + 1, budget, found, shown);
    } else if (isSecretPath(shown)) {
      if (matchesAny(entry.name, spec.excludes)) continue;
      if (spec.includes.length && !matchesAny(entry.name, spec.includes)) continue;
      found.push(shown);
    }
  }
}

// 재귀 검색이 훑게 될 시크릿 파일 목록(최대 3개). 없으면 빈 배열.
export function recursiveSearchHits(command, cwd = process.cwd()) {
  const found = [];
  for (const tokens of segmentsOf(command)) {
    const spec = searchSpec(tokens);
    if (!spec || spec.typed) continue;
    // 경로 인자가 없으면 현재 디렉터리를 훑는다. 파일만 지정했으면 디렉터리 탐색은 없다.
    const stats = spec.paths.map((path) => { try { return { path: resolve(cwd, path), dir: statSync(resolve(cwd, path)).isDirectory() }; } catch { return null; } }).filter(Boolean);
    const dirs = stats.length ? stats.filter((item) => item.dir).map((item) => item.path) : [resolve(cwd)];
    for (const dir of dirs) findSecrets(dir, spec, 0, { left: 4000 }, found, '');
    if (found.length) return { command: spec.command, files: found };
  }
  return null;
}

// 훅 입력 하나를 판정한다. 차단할 이유(문자열) 또는 null.
export function checkToolCall({ tool_input, cwd } = {}) {
  const input = tool_input ?? {};
  if (typeof input.command === 'string') {
    if (referencesSecret(input.command)) {
      return '차단됨: 시크릿 파일(.env·credentials·*.pem·secrets/)의 값은 읽거나 출력하지 않습니다. 키 이름은 .env.example 같은 예시 파일이나 설정 코드에서 확인하세요. 존재 확인(ls·test)과 검색 제외(--exclude)는 허용됩니다.';
    }
    const hits = recursiveSearchHits(input.command, cwd ?? process.cwd());
    if (hits) {
      const fix = hits.command === 'rg' ? "-g '!.env*'" : "--exclude='.env*'";
      return `차단됨: 이 재귀 검색은 시크릿 파일(${hits.files.join(', ')})의 내용을 출력할 수 있습니다. ${fix} 같은 제외 옵션을 붙이거나 검색할 디렉터리를 좁혀 다시 실행하세요.`;
    }
    return null;
  }
  // Read·Grep 도구: 파일 경로와 glob을 본다.
  const paths = [input.file_path, input.path, input.notebook_path, input.glob].filter((value) => typeof value === 'string');
  if (paths.some(isSecretPath)) {
    return '차단됨: 시크릿 파일(.env·credentials·*.pem·secrets/)은 열지 않습니다. 키 이름은 .env.example 같은 예시 파일이나 설정 코드에서 확인하세요.';
  }
  return null;
}

// 심링크 경로 호출 시 ESM URL(realpath) ↔ argv[1](원문) 불일치로 fail-open이 되지 않게
// 양쪽을 realpath로 정규화해 비교한다.
const toRealPath = (p) => { try { return realpathSync(p); } catch { return p; } };
const isDirectRun = process.argv[1] != null
  && toRealPath(process.argv[1]) === toRealPath(fileURLToPath(import.meta.url));
if (isDirectRun) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const reason = checkToolCall(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  if (reason) {
    console.error(reason);
    process.exit(2);
  }
}
