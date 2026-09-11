#!/usr/bin/env node
// 번들 자산만 추적한다. 도메인 스킬·사용자 기록·개인 설정은 관리 대상이 아니다.
import { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync, renameSync, unlinkSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateHarness } from './validateHarness.mjs';

const bundleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const manifestPath = '.claude/harness-install.json';
const settingsPath = '.claude/settings.json';
const hash = value => value == null ? null : createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const read = path => existsSync(path) ? readFileSync(path, 'utf8') : null;
const parse = (text, fallback) => text == null ? fallback : JSON.parse(text);
const version = () => JSON.parse(readFileSync(join(bundleRoot, '.claude-plugin/plugin.json'), 'utf8')).version;
const hookNames = ['blockGitMutation', 'blockSecretAccess', 'branchGuard'];
const deny = ['Read(./.env)', 'Read(./.env.*)', 'Read(./**/credentials*)', 'Read(./**/*.pem)', 'Read(./**/secrets/**)'];

// 계획·설치 기록에서 읽은 경로도 프로젝트 밖이나 심볼릭 링크를 따라가지 않는다.
function safePath(root, path) {
  if (!path || isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..' || part === '.' || !part)) {
    throw new Error(`허용되지 않는 상대 경로: ${path}`);
  }
  const result = resolve(root, path);
  const rel = relative(root, result);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('프로젝트 밖 경로입니다');
  let cursor = root;
  for (const part of path.split('/')) {
    cursor = join(cursor, part);
    try { if (lstatSync(cursor).isSymbolicLink()) throw new Error(`심볼릭 링크는 관리하지 않습니다: ${path}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return result;
}
function catalog({ profile = 'basic', verifier = false } = {}) {
  if (!['basic', 'collaboration'].includes(profile)) throw new Error('profile은 basic 또는 collaboration입니다');
  const files = {};
  for (const name of [...hookNames, ...(verifier ? ['verifierGate'] : [])]) {
    files[`.claude/hooks/${name}.mjs`] = `skills/harness/assets/hooks/${name}.mjs`;
  }
  files['docs/harness-rules.md'] = 'skills/harness/assets/harness-rules.md';
  for (const name of ['history', 'handoff', ...(profile === 'collaboration' ? ['retro', 'loop-spec'] : [])]) {
    files[`docs/templates/${name}.md`] = `skills/history/assets/templates/${name}.md`;
  }
  return files;
}
const allPaths = new Set(Object.keys(catalog({ profile: 'collaboration', verifier: true })));
function loadManifest(root) {
  const manifest = parse(read(safePath(root, manifestPath)), { schemaVersion: 1, files: {}, ownedHooks: [], ownedDeny: [] });
  if (manifest.schemaVersion !== 1 || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    throw new Error('지원하지 않는 설치 기록입니다');
  }
  for (const [path, entry] of Object.entries(manifest.files)) {
    if (!allPaths.has(path) || !/^[a-f0-9]{64}$/.test(entry?.hash)) throw new Error('설치 기록의 파일 항목이 잘못되었습니다');
  }
  if (!Array.isArray(manifest.ownedHooks) || !Array.isArray(manifest.ownedDeny)) throw new Error('설치 기록의 등록 항목이 잘못되었습니다');
  for (const item of manifest.ownedHooks) {
    if (!hookNames.concat('verifierGate').some(name => JSON.stringify(hookEntry(name)) === JSON.stringify(item))) {
      throw new Error('설치 기록에 알 수 없는 훅이 있습니다');
    }
  }
  if (manifest.ownedDeny.some(item => !deny.includes(item))) throw new Error('알 수 없는 권한 항목입니다');
  return manifest;
}
function hookEntry(name) {
  return { event: name === 'verifierGate' ? 'Stop' : 'PreToolUse', entry: {
    ...(name === 'verifierGate' ? {} : { matcher: name === 'branchGuard' ? 'Edit|Write|NotebookEdit' : 'Bash' }),
    hooks: [{ type: 'command', command: `node "$CLAUDE_PROJECT_DIR/.claude/hooks/${name}.mjs"` }],
  } };
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function atomicWrite(path, content) {
  if (content == null) { if (existsSync(path)) unlinkSync(path); return; }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  const mode = existsSync(path) ? lstatSync(path).mode & 0o777 : 0o600;
  writeFileSync(tmp, content, { mode });
  renameSync(tmp, path);
}

export function createPlan(project, options = {}) {
  const root = realpathSync(project);
  const previous = loadManifest(root);
  const mode = options.mode ?? 'update';
  if (!['update', 'remove'].includes(mode)) throw new Error('mode는 update 또는 remove입니다');
  const profile = options.profile ?? previous.profile ?? 'basic';
  const verifier = options.verifier ?? previous.verifier ?? false;
  const only = options.only ?? null;
  if (only != null && (!Array.isArray(only) || only.some(p => !allPaths.has(p)))) throw new Error('only에는 번들 관리 경로만 지정하세요');
  const request = { mode, profile, verifier, only };
  const next = structuredClone(previous);
  Object.assign(next, { version: version(), profile, verifier });
  const operations = [];
  const add = (path, action, before, after, reason) => operations.push({ path, action, beforeHash: hash(before), after, reason });
  const selected = path => only == null || only.includes(path);
  const target = catalog({ profile, verifier });
  for (const [path, source] of Object.entries(mode === 'remove' ? previous.files : target)) {
    if (!selected(path)) continue;
    const before = read(safePath(root, path));
    const tracked = previous.files[path];
    if (mode === 'remove') {
      // 문서와 사용자 기록은 제거해도 보존한다. 추적만 해제한다.
      if (path.startsWith('docs/')) { delete next.files[path]; add(path, 'preserve', before, before, '문서 보존 · 추적 해제'); continue; }
      if (before != null && hash(before) !== tracked.hash) { add(path, 'conflict', before, before, '사용자가 수정한 파일'); continue; }
      delete next.files[path];
      add(path, before == null ? 'unchanged' : 'delete', before, null, '설치한 훅 제거');
      continue;
    }
    const after = readFileSync(join(bundleRoot, source), 'utf8');
    if (before === after) {
      next.files[path] = { hash: hash(after), version: version() };
      add(path, tracked ? 'unchanged' : 'adopt', before, after, tracked ? '최신 파일' : '번들과 동일한 기존 파일을 추적');
    } else if (before != null && (!tracked || hash(before) !== tracked.hash)) {
      add(path, 'conflict', before, before, tracked ? '설치 후 수정됨 · 보존' : '출처를 확인할 수 없는 기존 파일 · 보존');
    } else {
      next.files[path] = { hash: hash(after), version: version() };
      add(path, before == null ? 'create' : 'update', before, after, '번들 파일 적용');
    }
  }
  // settings.json은 기존 키를 보존하고 이 도구가 추가한 정확한 항목만 추적한다.
  const settingsBefore = read(safePath(root, settingsPath));
  const settings = parse(settingsBefore, {});
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('settings.json은 객체여야 합니다');
  settings.hooks ??= {};
  settings.permissions ??= {};
  settings.permissions.deny ??= [];
  if (typeof settings.hooks !== 'object' || Array.isArray(settings.hooks) ||
      typeof settings.permissions !== 'object' || Array.isArray(settings.permissions) || !Array.isArray(settings.permissions.deny)) {
    throw new Error('settings.json의 hooks/permissions 형식을 확인하세요');
  }
  if (mode === 'update') {
    for (const name of [...hookNames, ...(verifier ? ['verifierGate'] : [])]) {
      if (!selected(`.claude/hooks/${name}.mjs`)) continue;
      const item = hookEntry(name);
      const entries = settings.hooks[item.event] ??= [];
      if (!Array.isArray(entries)) throw new Error('훅 이벤트는 배열이어야 합니다');
      // 다른 matcher/명령으로 등록된 기존 훅은 덮어쓰거나 중복 등록하지 않는다.
      const existing = entries.some(entry => entry.hooks?.some(hook => hook.command?.includes(`/hooks/${name}.mjs`)));
      if (!existing) {
        entries.push(item.entry);
        if (!next.ownedHooks.some(owned => same(owned, item))) next.ownedHooks.push(item);
      }
    }
    for (const item of deny) {
      if (!settings.permissions.deny.includes(item)) { settings.permissions.deny.push(item); next.ownedDeny.push(item); }
    }
  } else {
    next.ownedHooks = previous.ownedHooks.filter(item => {
      const name = hookNames.concat('verifierGate').find(name => same(hookEntry(name), item));
      if (!selected(`.claude/hooks/${name}.mjs`)) return true;
      const entries = settings.hooks[item.event] ?? [];
      if (!Array.isArray(entries)) throw new Error('훅 이벤트는 배열이어야 합니다');
      if (entries.some(entry => !same(entry, item.entry) && entry.hooks?.some(hook => hook.command?.includes(`/hooks/${name}.mjs`)))) {
        add(settingsPath, 'conflict', settingsBefore, settingsBefore, '수정한 훅 등록을 보존합니다. 참조를 확인한 뒤 제거하세요');
        return true;
      }
      settings.hooks[item.event] = entries.filter(entry => !same(entry, item.entry));
      return false;
    });
    if (Object.keys(next.files).length === 0) {
      settings.permissions.deny = settings.permissions.deny.filter(item => !previous.ownedDeny.includes(item));
      next.ownedDeny = [];
    }
  }
  if (mode === 'remove') {
    for (const op of operations.filter(op => op.action === 'delete')) {
      const name = op.path.split('/').pop();
      const referenced = Object.values(settings.hooks).some(entries => Array.isArray(entries) && entries.some(entry =>
        entry.hooks?.some(hook => hook.command?.includes(`/hooks/${name}`))));
      if (referenced) add(op.path, 'conflict', read(safePath(root, op.path)), read(safePath(root, op.path)), '남아 있는 훅 등록이 참조합니다');
    }
  }
  const originalSettings = parse(settingsBefore, {});
  const settingsAfter = same(settings, originalSettings) ? settingsBefore : json(settings);
  if (settingsAfter !== settingsBefore) add(settingsPath, 'update', settingsBefore, settingsAfter, '기존 설정 보존 · 관리 항목만 병합');
  const manifestBefore = read(safePath(root, manifestPath));
  const manifestAfter = json(next);
  if (manifestAfter !== manifestBefore) add(manifestPath, 'update', manifestBefore, manifestAfter, '설치 버전과 파일 해시 기록');
  return { schemaVersion: 1, root, bundleVersion: version(), request, operations };
}

export function applyPlan(plan) {
  if (plan.schemaVersion !== 1) throw new Error('지원하지 않는 계획입니다');
  // 저장된 계획을 실행 명령으로 신뢰하지 않는다. 현재 번들/파일에서 다시 계산해 일치해야 적용한다.
  const current = createPlan(plan.root, plan.request);
  if (!same(current, plan)) throw new Error('미리보기 이후 파일 또는 번들이 바뀌었습니다. 계획을 다시 만드세요');
  if (plan.operations.some(op => op.action === 'conflict')) throw new Error('충돌 파일을 보존했습니다. --only로 적용할 파일을 선택해 계획을 다시 만드세요');
  const changes = plan.operations.filter(op => hash(op.after) !== op.beforeHash);
  if (!changes.length) return { changed: 0, backup: null };
  const root = realpathSync(plan.root);
  const backup = `.claude/harness-backups/${randomUUID()}.json`;
  const records = changes.map(op => ({ path: op.path, before: read(safePath(root, op.path)), afterHash: hash(op.after) }));
  atomicWrite(safePath(root, backup), json({ schemaVersion: 1, root, records }));
  try {
    for (const op of changes) atomicWrite(safePath(root, op.path), op.after);
  } catch (error) {
    for (const record of [...records].reverse()) atomicWrite(safePath(root, record.path), record.before);
    throw error;
  }
  return { changed: changes.length, backup };
}
export function rollback(project, backup) {
  const root = realpathSync(project);
  if (!/^\.claude\/harness-backups\/[a-f0-9-]+\.json$/.test(backup)) throw new Error('허용되지 않는 백업 경로입니다');
  const data = JSON.parse(readFileSync(safePath(root, backup), 'utf8'));
  if (data.root !== root || data.schemaVersion !== 1 || !Array.isArray(data.records)) throw new Error('다른 프로젝트 또는 잘못된 백업입니다');
  for (const record of data.records) {
    if (!allPaths.has(record.path) && ![settingsPath, manifestPath].includes(record.path)) throw new Error('백업에 알 수 없는 파일이 있습니다');
    if (hash(read(safePath(root, record.path))) !== record.afterHash) throw new Error(`적용 후 수정된 파일은 복원하지 않습니다: ${record.path}`);
  }
  for (const record of [...data.records].reverse()) atomicWrite(safePath(root, record.path), record.before);
  return { restored: data.records.length };
}
export async function status(project) {
  const root = realpathSync(project);
  const manifest = loadManifest(root);
  const settings = parse(read(safePath(root, settingsPath)), {});
  const hooks = [...hookNames, 'verifierGate'].map(name => {
    const path = `.claude/hooks/${name}.mjs`;
    const content = read(safePath(root, path));
    const expected = readFileSync(join(bundleRoot, `skills/harness/assets/hooks/${name}.mjs`), 'utf8');
    const item = hookEntry(name);
    const registered = (settings.hooks?.[item.event] ?? []).some(entry =>
      (entry.matcher ?? '') === (item.entry.matcher ?? '') && entry.hooks?.some(hook => hook.command === item.entry.hooks[0].command));
    return { name, file: content == null ? 'missing' : content === expected ? 'current' : 'different', registered,
      configuration: existsSync(safePath(root, `.claude/hooks/${name}.config.json`)) ? 'present' : 'default',
      note: name === 'verifierGate' ? '설정 없으면 비활성 · Stop에서만 검사' : 'Claude Code 훅 환경에서만 적용' };
  });
  let branch = null;
  try { branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* 비 git 프로젝트 */ }
  const all = catalog({ profile: 'collaboration', verifier: true });
  const files = Object.entries(manifest.files).map(([path, entry]) => {
    const content = read(safePath(root, path));
    const expected = readFileSync(join(bundleRoot, all[path]), 'utf8');
    return { path, installedVersion: entry.version ?? null, state: content == null ? 'missing' :
      hash(content) !== entry.hash ? 'modified' : content === expected ? 'current' : 'update-available' };
  });
  const issues = await validateHarness({ rootDir: root });
  for (const hook of hooks) {
    if (hook.name !== 'verifierGate' && (hook.file === 'missing' || !hook.registered)) issues.push({ level: 'warn', path: `.claude/hooks/${hook.name}.mjs`, message: `${hook.name}: 파일 또는 등록이 없습니다. plan으로 설치 목록을 확인하세요` });
    if (hook.file === 'different') issues.push({ level: 'warn', path: `.claude/hooks/${hook.name}.mjs`, message: `${hook.name}: 번들과 다릅니다. 사용자 수정 여부를 비교하세요` });
    const configPath = safePath(root, `.claude/hooks/${hook.name}.config.json`);
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error();
        if (hook.name === 'branchGuard' && config.protectedBranches != null &&
            (!Array.isArray(config.protectedBranches) || config.protectedBranches.some(b => typeof b !== 'string'))) throw new Error();
        if (hook.name === 'verifierGate' && (!Array.isArray(config.checks) || !config.checks.length ||
            config.checks.some(c => !c || typeof c.command !== 'string' || !c.command.trim() || typeof c.name !== 'string'))) throw new Error();
      } catch { issues.push({ level: 'error', path: configPath, message: '훅 설정 형식이 잘못되었습니다. 값을 출력하지 않고 파일 위치만 표시합니다' }); }
    }
  }
  return { root, bundleVersion: version(), installedVersion: Object.keys(manifest.files).length ? manifest.version ?? null : null, nodeVersion: process.version, branch,
    hooks, files, trackedFiles: Object.keys(manifest.files).length, issues,
    note: '등록 여부는 설정 파일 기준입니다. 현재 앱의 훅 실행 지원 여부는 별도 확인이 필요합니다.' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, project = '.', ...args] = process.argv.slice(2);
    const value = flag => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
    const allowed = { status: ['--json'], plan: ['--json', '--out', '--mode', '--profile', '--verifier', '--only'], apply: ['--plan'], rollback: ['--backup'] };
    if (!allowed[command]) throw new Error('사용법: harnessManager.mjs status|plan|apply|rollback <프로젝트> [옵션]');
    for (let i = 0; i < args.length; i++) {
      if (!allowed[command].includes(args[i])) throw new Error(`알 수 없는 옵션: ${args[i]}`);
      if (!['--json', '--verifier'].includes(args[i]) && (!args[++i] || args[i].startsWith('--'))) throw new Error('옵션 값이 필요합니다');
    }
    if (command === 'status') {
      const result = await status(project);
      if (args.includes('--json')) console.log(json(result));
      else {
        console.log(`번들 ${result.bundleVersion} / 설치 ${result.installedVersion ?? '추적 기록 없음'} / 브랜치 ${result.branch ?? '없음'}`);
        for (const hook of result.hooks) console.log(`${hook.name}: 파일 ${hook.file}, 등록 ${hook.registered ? '있음' : '없음'}, 설정 ${hook.configuration}`);
        for (const file of result.files.filter(file => file.state !== 'current')) console.log(`${file.path}: ${file.state} (설치 ${file.installedVersion ?? '알 수 없음'})`);
        for (const issue of result.issues) console.log(`${issue.level}: ${issue.message}`);
        console.log(result.note);
      }
      process.exitCode = result.issues.some(i => i.level === 'error') ? 1 : 0;
    } else if (command === 'plan') {
      const result = createPlan(project, { mode: value('--mode'), profile: value('--profile'), verifier: args.includes('--verifier') ? true : undefined, only: value('--only')?.split(',') });
      if (value('--out')) writeFileSync(value('--out'), json(result), { flag: 'wx', mode: 0o600 });
      if (args.includes('--json')) console.log(json(result));
      else for (const op of result.operations) console.log(`${op.action}: ${op.path} — ${op.reason}`);
      process.exitCode = result.operations.some(op => op.action === 'conflict') ? 1 : 0;
    } else if (command === 'apply') {
      if (!value('--plan')) throw new Error('--plan으로 검토한 계획 파일을 지정하세요');
      const plan = JSON.parse(readFileSync(value('--plan'), 'utf8'));
      if (realpathSync(project) !== plan.root) throw new Error('계획의 프로젝트가 다릅니다');
      console.log(json(applyPlan(plan)));
    } else {
      if (!value('--backup')) throw new Error('--backup으로 백업 경로를 지정하세요');
      console.log(json(rollback(project, value('--backup'))));
    }
  } catch (error) { console.error(`적용하지 못했습니다: ${error.message}`); process.exitCode = 1; }
}
