// Workspace discovery is read-only. Existing task runners remain responsible for execution/caching.
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import picomatch from 'picomatch';

const slash = value => value.split(sep).join('/');
const ignored = new Set(['node_modules', '.git', '.agents', '.codex', '.claude', '.next', '.turbo', '.nx', 'coverage']);
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const isInside = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`); };
const workspaceMarker = dir => {
  if (existsSync(join(dir, 'pnpm-workspace.yaml')) || existsSync(join(dir, 'nx.json'))) return true;
  try { return json(join(dir, 'package.json')).workspaces != null; } catch { return false; }
};

export function resolveProjectRoot(project) {
  const start = realpathSync(project);
  for (let dir = start; ; dir = dirname(dir)) {
    if (workspaceMarker(dir) || existsSync(join(dir, '.agents/harness-install.json'))) return dir;
    if (existsSync(join(dir, '.git')) || dirname(dir) === dir) return start;
  }
}

export function discoverWorkspaces(project) {
  const root = resolveProjectRoot(project);
  const issues = [];
  const read = (path, yaml = false) => {
    if (!existsSync(join(root, path))) return null;
    try {
      const real = realpathSync(join(root, path));
      if (!isInside(root, real)) throw new Error('workspace 밖의 파일');
      const text = readFileSync(real, 'utf8');
      const value = yaml ? parseYaml(text, { prettyErrors: false, logLevel: 'error', maxAliasCount: 100 }) : JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('객체 설정이 필요합니다');
      return value;
    } catch { issues.push({ path, message: '설정 파일을 읽거나 해석하지 못했습니다' }); return null; }
  };
  const pkg = read('package.json') ?? {};
  const pnpm = read('pnpm-workspace.yaml', true);
  let patterns = pnpm?.packages ?? (Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages) ?? [];
  const declared = existsSync(join(root, 'pnpm-workspace.yaml')) || pkg.workspaces != null;
  if (pkg.workspaces != null && !Array.isArray(pkg.workspaces) && !Array.isArray(pkg.workspaces?.packages)) issues.push({ path: 'package.json', message: 'workspaces는 glob 배열 또는 packages 배열을 가진 객체여야 합니다' });
  if (!Array.isArray(patterns) || patterns.some(value => typeof value !== 'string' || !value.replace(/^!/, '') || value.includes('\\') || value.replace(/^!/, '').split('/').includes('..') || /^!?(?:\/|[a-z]:)/i.test(value))) {
    issues.push({ path: 'workspaces', message: 'workspace 경로는 저장소 안의 glob 배열이어야 합니다' });
    patterns = [];
  }
  const runner = existsSync(join(root, 'nx.json')) ? 'nx' : existsSync(join(root, 'turbo.json')) ? 'turbo' : null;
  const packageManager = /^(npm|pnpm|yarn|bun)@/.exec(pkg.packageManager ?? '')?.[1]
    ?? (pnpm || existsSync(join(root, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(root, 'yarn.lock')) ? 'yarn' : existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb')) ? 'bun' : 'npm');
  const enabled = patterns.length > 0 || runner === 'nx';
  const positive = patterns.filter(p => !p.startsWith('!')).map(p => picomatch(p.replace(/^\.\//, '').replace(/\/$/, ''), { dot: true }));
  const negative = patterns.filter(p => p.startsWith('!')).map(p => picomatch(p.slice(1).replace(/^\.\//, '').replace(/\/$/, ''), { dot: true }));
  const matches = path => !negative.some(match => match(path)) && (positive.some(match => match(path)) || (!declared && runner === 'nx'));
  const projects = [];
  const guidance = [];
  let visited = 0;
  const walk = path => {
    if (++visited > 20000) throw new Error('workspace 탐색 한도(20,000 디렉터리)를 넘었습니다');
    const entries = readdirSync(join(root, path), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const app of ['AGENTS.md', 'CLAUDE.md']) {
      if (entries.some(entry => entry.name === app && entry.isFile())) guidance.push({ path: path ? `${path}/${app}` : app, scope: path || '.', app: app === 'AGENTS.md' ? 'codex' : 'claude' });
    }
    if (path && matches(path) && entries.some(entry => entry.name === 'package.json' && entry.isFile())) {
      const manifest = read(`${path}/package.json`);
      if (manifest && typeof manifest === 'object' && !Array.isArray(manifest)) {
        projects.push({ name: typeof manifest.name === 'string' && manifest.name ? manifest.name : path, path,
          scripts: manifest.scripts && typeof manifest.scripts === 'object' ? manifest.scripts : {},
          dependencyNames: [...new Set(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap(key => Object.keys(manifest[key] ?? {})))],
          manifest: `${path}/package.json` });
      }
    }
    for (const entry of entries) {
      const child = path ? `${path}/${entry.name}` : entry.name;
      if (ignored.has(entry.name) || !entry.isDirectory()) continue;
      // A nested Git repository owns its own policies and lifecycle.
      if (existsSync(join(root, child, '.git'))) continue;
      walk(child);
    }
  };
  if (enabled) {
    try { walk(''); } catch (error) { issues.push({ path: '.', message: error.message }); }
    if (!projects.length) issues.push({ path: 'workspaces', message: 'workspace 선언은 있지만 패키지를 찾지 못했습니다' });
  }
  const byName = new Map();
  for (const item of projects) {
    if (byName.has(item.name)) issues.push({ path: item.path, message: `중복 workspace 이름: ${item.name}` });
    byName.set(item.name, item);
  }
  for (const item of projects) {
    item.dependencies = item.dependencyNames.filter(name => byName.has(name));
    delete item.dependencyNames;
    item.guidance = guidance.filter(rule => rule.scope === '.' || rule.scope === item.path || item.path.startsWith(`${rule.scope}/`) || rule.scope.startsWith(`${item.path}/`));
  }
  // Only discovered defaults are ordered here. Explicit team checks retain their order.
  const ordered = [], visiting = new Set(), done = new Set();
  const visit = item => {
    if (done.has(item.name)) return;
    if (visiting.has(item.name)) throw new Error(`workspace 의존 순환: ${item.name}. 내부 의존 선언을 검토하세요`);
    visiting.add(item.name);
    for (const name of item.dependencies) visit(byName.get(name));
    visiting.delete(item.name);
    done.add(item.name);
    ordered.push(item);
  };
  try { for (const item of projects) visit(item); }
  catch (error) { issues.push({ path: 'workspaces', message: error.message }); }
  const currentPath = slash(relative(root, realpathSync(project))) || '.';
  const current = [...projects].sort((a, b) => b.path.length - a.path.length).find(item => currentPath === item.path || currentPath.startsWith(`${item.path}/`));
  return { root, enabled, packageManager, runner, patterns, projects: ordered.length === projects.length ? ordered : projects, guidance, issues, current: current?.name ?? null };
}

export function workspaceCommands(workspace) {
  const candidates = ['build', 'typecheck', 'type-check', 'lint', 'test', 'check'];
  return workspace.projects.flatMap(project => candidates.filter(name => typeof project.scripts[name] === 'string' && project.scripts[name].trim()).map(name => ({
    name: `${project.name}:${name}`, command: `${workspace.packageManager} run ${name}`, cwd: project.path, workspace: project.name,
    source: `${project.manifest}#scripts.${name}`, script: project.scripts[name],
    runnable: /no test specified|^\s*exit\s+1\s*$/.test(project.scripts[name]) ? 'placeholder' : 'unknown',
    note: '패키지 검증 명령 — 지정한 cwd에서 실행하며 의존성 설치·통과 여부는 별도 확인',
  })));
}

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }).trimEnd();
export function changedFiles(root, base) {
  const mergeBase = git(root, ['merge-base', '--', base, 'HEAD']);
  // --no-renames includes both old and new paths; -z handles whitespace and newlines.
  const tracked = git(root, ['diff', '--no-renames', '--name-only', '-z', mergeBase, '--']).split('\0');
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0');
  return { base: mergeBase, files: [...new Set([...tracked, ...untracked].filter(Boolean))].sort() };
}

export function selectAffected(workspace, files) {
  const reasons = new Map();
  const all = reason => ({ mode: 'all', projects: workspace.projects.map(item => item.name), reasons: [reason] });
  if (!workspace.enabled) return all('단일 프로젝트');
  if (workspace.issues.length) return all('workspace 탐색 오류로 전체 검증');
  // Native runners can contain implicit edges, global inputs, and inferred tasks.
  // Until their graph has been resolved, manifest-only narrowing is unsafe.
  if (workspace.runner) return all(`${workspace.runner}의 암묵적 의존 관계를 확인하지 않아 전체 검증`);
  const sorted = [...workspace.projects].sort((a, b) => b.path.length - a.path.length);
  for (const file of files) {
    const owner = sorted.find(item => file === item.path || file.startsWith(`${item.path}/`));
    if (!owner) return all(`공통·삭제된 패키지·미분류 경로 변경: ${file}`);
    if (file === owner.manifest || /(?:^|\/)(?:AGENTS|CLAUDE)\.md$/.test(file)) return all(`의존 관계 또는 규칙 변경: ${file}`);
    reasons.set(owner.name, `직접 변경: ${file}`);
  }
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const item of workspace.projects) {
      if (reasons.has(item.name)) continue;
      const dependency = item.dependencies.find(name => reasons.has(name));
      if (dependency) { reasons.set(item.name, `${dependency} 사용`); expanded = true; }
    }
  }
  return { mode: files.length ? 'affected' : 'none', projects: [...reasons.keys()].sort(), reasons: Object.fromEntries(reasons) };
}

export function verificationPlan(root, checks, { affected = false, base = null, workspace: selected = null } = {}) {
  const inventory = discoverWorkspaces(root);
  const issues = [...inventory.issues];
  let selection = { mode: 'all', projects: inventory.projects.map(item => item.name), reasons: ['전체 검증'] };
  let changes = null;
  if (affected) {
    try {
      if (!base) throw new Error('비교 기준 --base가 필요합니다');
      changes = changedFiles(inventory.root, base);
      selection = selectAffected(inventory, changes.files);
    } catch { selection.reasons = ['Git 비교 기준을 확인하지 못해 전체 검증']; }
  }
  if (selected) {
    if (!inventory.projects.some(item => item.name === selected)) throw new Error(`workspace를 찾을 수 없습니다: ${selected}`);
    selection = { mode: 'workspace', projects: [selected], reasons: ['사용자가 선택한 패키지 — 저장소 전체 검증이 아님'] };
  }
  // A clean checkout may need unchanged dependencies built before affected consumers.
  // Include their configured checks as prerequisites, rather than inventing build commands.
  const prerequisites = new Set();
  if (selection.mode === 'affected') {
    const include = name => {
      for (const dependency of inventory.projects.find(item => item.name === name)?.dependencies ?? []) {
        if (prerequisites.has(dependency) || selection.projects.includes(dependency)) continue;
        prerequisites.add(dependency);
        include(dependency);
      }
    };
    for (const name of selection.projects) include(name);
  }
  selection.prerequisites = [...prerequisites].sort();
  const chosen = checks.filter(check => !check.workspace || selection.projects.includes(check.workspace) || prerequisites.has(check.workspace));
  for (const check of checks) if (check.workspace && !inventory.projects.some(item => item.name === check.workspace && item.path === (check.cwd ?? '.'))) {
    issues.push({ path: check.cwd ?? '.', message: `검증 명세의 workspace·cwd가 현재 구조와 다릅니다: ${check.workspace}` });
  }
  for (const name of [...selection.projects, ...prerequisites]) if (!chosen.some(check => check.workspace === name) && !chosen.some(check => !check.workspace && (!check.cwd || check.cwd === '.'))) {
    issues.push({ path: name, message: '대상 패키지의 검증 명령이 없습니다' });
  }
  if (!chosen.length && selection.mode !== 'none') issues.push({ path: '.', message: '실행할 검증 명령이 없습니다' });
  // Stable IDs let reports refer to the exact command and scope without conflating packages.
  const planned = chosen.map(check => ({ ...check, id: createHash('sha256').update(JSON.stringify(check)).digest('hex').slice(0, 16) }));
  return { selection, changes, checks: planned, issues, inventory };
}
