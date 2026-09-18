#!/usr/bin/env node
// 번들 자산만 추적한다. 도메인 스킬·사용자 기록·개인 설정은 관리 대상이 아니다.
// 관리 파일(훅·추적 기록·백업)은 앱 중립 위치 .agents/에 둔다. 훅 등록만 앱별 파일에 쓴다:
//   claude → .claude/settings.json (hooks + permissions.deny), codex → .codex/hooks.json (hooks)
// v2.x가 설치한 .claude/hooks/·.claude/harness-install.json은 업데이트 계획에서 새 위치로 이동한다.
import { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync, renameSync, unlinkSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateHarness } from './validateHarness.mjs';

const bundleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const hooksDir = '.agents/hooks';
const legacyHooksDir = '.claude/hooks';
const manifestPath = '.agents/harness-install.json';
const legacyManifestPath = '.claude/harness-install.json';
const backupDir = '.agents/harness-backups';
// 앱별 훅 등록 파일. signals는 --app 생략 시 프로젝트에서 앱을 추정하는 단서다.
const apps = {
  claude: { registry: '.claude/settings.json', signals: ['.claude', 'CLAUDE.md'] },
  codex: { registry: '.codex/hooks.json', signals: ['.codex', 'AGENTS.md', '.agents/skills', '.agents/plugins'] },
};
const appNames = Object.keys(apps);
const hash = value => value == null ? null : createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const read = path => existsSync(path) ? readFileSync(path, 'utf8') : null;
const parse = (text, fallback) => text == null ? fallback : JSON.parse(text);
const version = () => JSON.parse(readFileSync(join(bundleRoot, '.claude-plugin/plugin.json'), 'utf8')).version;
const hookNames = ['blockGitMutation', 'blockSecretAccess', 'branchGuard'];
const allHookNames = [...hookNames, 'verifierGate'];
const deny = ['Read(./.env)', 'Read(./.env.*)', 'Read(./**/credentials*)', 'Read(./**/*.pem)', 'Read(./**/secrets/**)'];
const hookPath = name => `${hooksDir}/${name}.mjs`;
const legacyHookPath = name => `${legacyHooksDir}/${name}.mjs`;
const configPath = (dir, name) => `${dir}/${name}.config.json`;
const hookSource = name => `skills/harness/assets/hooks/${name}.mjs`;

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
  for (const name of [...hookNames, ...(verifier ? ['verifierGate'] : [])]) files[hookPath(name)] = hookSource(name);
  files['docs/harness-rules.md'] = 'skills/harness/assets/harness-rules.md';
  for (const name of ['history', 'handoff', ...(profile === 'collaboration' ? ['retro', 'loop-spec'] : [])]) {
    files[`docs/templates/${name}.md`] = `skills/history/assets/templates/${name}.md`;
  }
  return files;
}
const allPaths = new Set(Object.keys(catalog({ profile: 'collaboration', verifier: true })));
const legacyPaths = new Set(allHookNames.map(legacyHookPath));
// 복원 대상으로 인정하는 경로: 번들 파일, 이전 위치 훅, 훅 설정(이동), 등록 파일, 추적 기록.
const restorablePaths = new Set([
  ...allPaths, ...legacyPaths, manifestPath, legacyManifestPath,
  ...appNames.map(app => apps[app].registry),
  ...allHookNames.flatMap(name => [configPath(hooksDir, name), configPath(legacyHooksDir, name)]),
]);

function hookEntry(name, app = 'claude') {
  if (!appNames.includes(app)) throw new Error(`알 수 없는 앱: ${app}`);
  const event = name === 'verifierGate' ? 'Stop' : 'PreToolUse';
  // codex는 파일 편집 도구를 apply_patch로 보고한다(matcher에 Edit·Write 별칭 허용). NotebookEdit은 claude 전용이다.
  const matcher = name === 'branchGuard' ? (app === 'codex' ? 'apply_patch|Edit|Write' : 'Edit|Write|NotebookEdit') : 'Bash';
  // codex에는 CLAUDE_PROJECT_DIR가 없다. 프로젝트 hooks.json은 프로젝트 루트를 현재 디렉터리로 실행한다고 가정한다.
  const command = app === 'codex' ? `node "${hookPath(name)}"` : `node "$CLAUDE_PROJECT_DIR/${hookPath(name)}"`;
  return { app, event, entry: { ...(event === 'Stop' ? {} : { matcher }), hooks: [{ type: 'command', command }] } };
}
// v2.x 등록 형태(claude 전용, .claude/hooks 경로). 이동 판정에만 쓴다.
function legacyHookEntry(name) {
  const event = name === 'verifierGate' ? 'Stop' : 'PreToolUse';
  return { app: 'claude', event, entry: {
    ...(event === 'Stop' ? {} : { matcher: name === 'branchGuard' ? 'Edit|Write|NotebookEdit' : 'Bash' }),
    hooks: [{ type: 'command', command: `node "$CLAUDE_PROJECT_DIR/${legacyHookPath(name)}"` }],
  } };
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
const normalizeOwned = item => ({ app: item?.app ?? 'claude', event: item?.event, entry: item?.entry });
const sameHook = (a, b) => same(normalizeOwned(a), normalizeOwned(b));
const knownHook = item => allHookNames.some(name => appNames.some(app => sameHook(hookEntry(name, app), item)) || sameHook(legacyHookEntry(name), item));
const hookNameOf = item => allHookNames.find(name => appNames.some(app => sameHook(hookEntry(name, app), item)) || sameHook(legacyHookEntry(name), item));

function loadManifest(root) {
  let text = read(safePath(root, manifestPath));
  let legacy = false;
  if (text == null) { text = read(safePath(root, legacyManifestPath)); legacy = text != null; }
  const manifest = parse(text, { schemaVersion: 1, files: {}, ownedHooks: [], ownedDeny: [] });
  if (manifest.schemaVersion !== 1 || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    throw new Error('지원하지 않는 설치 기록입니다');
  }
  for (const [path, entry] of Object.entries(manifest.files)) {
    if ((!allPaths.has(path) && !legacyPaths.has(path)) || !/^[a-f0-9]{64}$/.test(entry?.hash)) throw new Error('설치 기록의 파일 항목이 잘못되었습니다');
  }
  if (!Array.isArray(manifest.ownedHooks) || !Array.isArray(manifest.ownedDeny)) throw new Error('설치 기록의 등록 항목이 잘못되었습니다');
  manifest.ownedHooks = manifest.ownedHooks.map(normalizeOwned);
  if (manifest.ownedHooks.some(item => !knownHook(item))) throw new Error('설치 기록에 알 수 없는 훅이 있습니다');
  if (manifest.ownedDeny.some(item => !deny.includes(item))) throw new Error('알 수 없는 권한 항목입니다');
  if (manifest.apps != null && (!Array.isArray(manifest.apps) || manifest.apps.some(app => !appNames.includes(app)))) throw new Error('설치 기록의 앱 항목이 잘못되었습니다');
  return { manifest, legacyManifest: legacy };
}
export function detectApps(root) {
  const found = appNames.filter(app => apps[app].signals.some(signal => existsSync(join(root, signal))));
  return found.length ? found : ['claude'];
}
function resolveApps(option, previous, root) {
  if (option == null) return previous.apps ?? detectApps(root);
  if (option === 'both') return [...appNames];
  if (!appNames.includes(option)) throw new Error('app은 claude, codex 또는 both입니다');
  return [option];
}
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
  const { manifest: previous, legacyManifest } = loadManifest(root);
  const mode = options.mode ?? 'update';
  if (!['update', 'remove'].includes(mode)) throw new Error('mode는 update 또는 remove입니다');
  const profile = options.profile ?? previous.profile ?? 'basic';
  const verifier = options.verifier ?? previous.verifier ?? false;
  const only = options.only ?? null;
  if (only != null && (!Array.isArray(only) || only.some(p => !allPaths.has(p)))) throw new Error('only에는 번들 관리 경로만 지정하세요');
  const selectedApps = resolveApps(options.app ?? null, previous, root);
  const request = { mode, profile, verifier, only, app: options.app ?? null };
  const next = structuredClone(previous);
  Object.assign(next, { version: version(), profile, verifier, apps: selectedApps });
  const operations = [];
  const add = (path, action, before, after, reason) => operations.push({ path, action, beforeHash: hash(before), after, reason });
  const selected = path => only == null || only.includes(path);
  const target = catalog({ profile, verifier });
  const activeHooks = [...hookNames, ...(verifier ? ['verifierGate'] : [])];
  for (const [path, source] of Object.entries(mode === 'remove' ? previous.files : target)) {
    if (!selected(legacyPaths.has(path) ? path.replace(legacyHooksDir, hooksDir) : path)) continue;
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
    // 이전 위치(.claude/hooks)에 추적된 훅은 수정되지 않았을 때만 새 위치로 옮긴다. 설정 파일도 함께 옮긴다.
    const name = activeHooks.find(candidate => hookPath(candidate) === path);
    if (name && previous.files[legacyHookPath(name)]) {
      const legacyPath = legacyHookPath(name);
      const legacyBefore = read(safePath(root, legacyPath));
      if (legacyBefore != null && hash(legacyBefore) !== previous.files[legacyPath].hash) {
        add(legacyPath, 'conflict', legacyBefore, legacyBefore, '이전 위치의 파일을 수정함 · 이동하지 않음');
        continue;
      }
      delete next.files[legacyPath];
      add(legacyPath, legacyBefore == null ? 'unchanged' : 'delete', legacyBefore, null, `${hooksDir}로 이동`);
      const oldConfig = configPath(legacyHooksDir, name);
      const oldContent = read(safePath(root, oldConfig));
      if (oldContent != null) {
        const newConfig = configPath(hooksDir, name);
        const newContent = read(safePath(root, newConfig));
        if (newContent == null) { add(newConfig, 'create', null, oldContent, '훅 설정 이동'); add(oldConfig, 'delete', oldContent, null, '훅 설정 이동'); }
        else if (newContent === oldContent) add(oldConfig, 'delete', oldContent, null, '새 위치와 같은 설정 · 이전 파일 제거');
        else add(oldConfig, 'conflict', oldContent, oldContent, '새 위치에 다른 설정이 있음 · 직접 비교 후 정리');
      }
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
  // 등록 파일은 기존 키를 보존하고 이 도구가 추가한 정확한 항목만 추적한다.
  const registries = {};
  const loadRegistry = app => {
    if (registries[app]) return registries[app];
    const path = apps[app].registry;
    const before = read(safePath(root, path));
    const data = parse(before, {});
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${path}은 객체여야 합니다`);
    data.hooks ??= {};
    if (typeof data.hooks !== 'object' || Array.isArray(data.hooks)) throw new Error(`${path}의 hooks 형식을 확인하세요`);
    if (app === 'claude') {
      data.permissions ??= {};
      data.permissions.deny ??= [];
      if (typeof data.permissions !== 'object' || Array.isArray(data.permissions) || !Array.isArray(data.permissions.deny)) {
        throw new Error(`${path}의 permissions 형식을 확인하세요`);
      }
    }
    return registries[app] = { path, before, data, original: parse(before, {}) };
  };
  const entriesOf = (registry, event) => {
    const entries = registry.data.hooks[event] ??= [];
    if (!Array.isArray(entries)) throw new Error('훅 이벤트는 배열이어야 합니다');
    return entries;
  };
  const references = (entries, name) => entries.some(entry => entry.hooks?.some(hook => hook.command?.includes(`/hooks/${name}.mjs`)));
  if (mode === 'update') {
    for (const app of selectedApps) {
      const registry = loadRegistry(app);
      for (const name of activeHooks) {
        if (!selected(hookPath(name))) continue;
        const item = hookEntry(name, app);
        // 이전 위치로 등록한 소유 항목은 새 등록으로 교체한다. 수동 등록은 건드리지 않는다.
        const legacy = legacyHookEntry(name);
        if (app === 'claude' && next.ownedHooks.some(owned => sameHook(owned, legacy))) {
          registry.data.hooks[item.event] = entriesOf(registry, item.event).filter(entry => !same(entry, legacy.entry));
          next.ownedHooks = next.ownedHooks.filter(owned => !sameHook(owned, legacy));
        }
        const entries = entriesOf(registry, item.event);
        // 다른 matcher/명령으로 등록된 기존 훅은 덮어쓰거나 중복 등록하지 않는다.
        if (!references(entries, name)) {
          entries.push(item.entry);
          if (!next.ownedHooks.some(owned => sameHook(owned, item))) next.ownedHooks.push(item);
        }
      }
      if (app === 'claude') {
        for (const item of deny) {
          if (!registry.data.permissions.deny.includes(item)) { registry.data.permissions.deny.push(item); next.ownedDeny.push(item); }
        }
      }
    }
  } else {
    next.ownedHooks = previous.ownedHooks.filter(item => {
      const name = hookNameOf(item);
      if (!selected(hookPath(name))) return true;
      const registry = loadRegistry(item.app);
      const entries = entriesOf(registry, item.event);
      if (entries.some(entry => !same(entry, item.entry) && entry.hooks?.some(hook => hook.command?.includes(`/hooks/${name}.mjs`)))) {
        add(registry.path, 'conflict', registry.before, registry.before, '수정한 훅 등록을 보존합니다. 참조를 확인한 뒤 제거하세요');
        return true;
      }
      registry.data.hooks[item.event] = entries.filter(entry => !same(entry, item.entry));
      return false;
    });
    if (Object.keys(next.files).length === 0 && previous.ownedDeny.length) {
      const registry = loadRegistry('claude');
      registry.data.permissions.deny = registry.data.permissions.deny.filter(item => !previous.ownedDeny.includes(item));
      next.ownedDeny = [];
    }
  }
  // 제거·이동으로 사라질 훅 파일을 남은 등록(다른 앱·수동 등록)이 참조하면 충돌로 보존한다.
  for (const op of operations.filter(op => op.action === 'delete' && op.path.endsWith('.mjs'))) {
    const referenced = appNames.some(app => {
      const data = registries[app]?.data ?? parse(read(safePath(root, apps[app].registry)), {});
      return Object.values(data.hooks ?? {}).some(entries => Array.isArray(entries) && entries.some(entry =>
        entry.hooks?.some(hook => hook.command?.includes(op.path))));
    });
    if (referenced) add(op.path, 'conflict', read(safePath(root, op.path)), read(safePath(root, op.path)), '남아 있는 훅 등록이 참조합니다');
  }
  for (const registry of Object.values(registries)) {
    const after = same(registry.data, registry.original) ? registry.before : json(registry.data);
    if (after !== registry.before) add(registry.path, 'update', registry.before, after, '기존 설정 보존 · 관리 항목만 병합');
  }
  const manifestBefore = read(safePath(root, manifestPath));
  const manifestAfter = json(next);
  if (manifestAfter !== manifestBefore) add(manifestPath, 'update', manifestBefore, manifestAfter, '설치 버전과 파일 해시 기록');
  if (legacyManifest) {
    const legacyText = read(safePath(root, legacyManifestPath));
    add(legacyManifestPath, 'delete', legacyText, null, `${manifestPath}로 이동`);
  }
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
  const backup = `${backupDir}/${randomUUID()}.json`;
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
  if (!/^\.(?:agents|claude)\/harness-backups\/[a-f0-9-]+\.json$/.test(backup)) throw new Error('허용되지 않는 백업 경로입니다');
  const data = JSON.parse(readFileSync(safePath(root, backup), 'utf8'));
  if (data.root !== root || data.schemaVersion !== 1 || !Array.isArray(data.records)) throw new Error('다른 프로젝트 또는 잘못된 백업입니다');
  for (const record of data.records) {
    if (!restorablePaths.has(record.path)) throw new Error('백업에 알 수 없는 파일이 있습니다');
    if (hash(read(safePath(root, record.path))) !== record.afterHash) throw new Error(`적용 후 수정된 파일은 복원하지 않습니다: ${record.path}`);
  }
  for (const record of [...data.records].reverse()) atomicWrite(safePath(root, record.path), record.before);
  return { restored: data.records.length };
}
export async function status(project) {
  const root = realpathSync(project);
  const { manifest, legacyManifest } = loadManifest(root);
  const registries = Object.fromEntries(appNames.map(app => [app, parse(read(safePath(root, apps[app].registry)), {})]));
  const targetApps = manifest.apps ?? detectApps(root);
  const hooks = allHookNames.map(name => {
    const content = read(safePath(root, hookPath(name)));
    const legacyContent = read(safePath(root, legacyHookPath(name)));
    const expected = readFileSync(join(bundleRoot, hookSource(name)), 'utf8');
    const registered = Object.fromEntries(appNames.map(app => {
      const item = hookEntry(name, app);
      const entries = registries[app].hooks?.[item.event];
      return [app, Array.isArray(entries) && entries.some(entry =>
        (entry.matcher ?? '') === (item.entry.matcher ?? '') && entry.hooks?.some(hook => hook.command === item.entry.hooks[0].command))];
    }));
    const configuration = existsSync(safePath(root, configPath(hooksDir, name))) ? 'present'
      : existsSync(safePath(root, configPath(legacyHooksDir, name))) ? 'legacy' : 'default';
    return { name, file: content == null ? (legacyContent == null ? 'missing' : 'legacy') : content === expected ? 'current' : 'different',
      registered, configuration,
      note: name === 'verifierGate' ? '설정 없으면 비활성 · Stop에서만 검사' : '훅 이벤트를 지원하는 앱(claude·codex)에서만 적용' };
  });
  let branch = null;
  try { branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* 비 git 프로젝트 */ }
  const all = catalog({ profile: 'collaboration', verifier: true });
  const files = Object.entries(manifest.files).map(([path, entry]) => {
    const content = read(safePath(root, path));
    const expected = readFileSync(join(bundleRoot, all[path] ?? all[path.replace(legacyHooksDir, hooksDir)]), 'utf8');
    return { path, installedVersion: entry.version ?? null, state: content == null ? 'missing' :
      hash(content) !== entry.hash ? 'modified' : legacyPaths.has(path) ? 'legacy-location' : content === expected ? 'current' : 'update-available' };
  });
  const issues = await validateHarness({ rootDir: root });
  if (legacyManifest) issues.push({ level: 'warn', path: legacyManifestPath, message: `설치 기록이 이전 위치에 있습니다. plan·apply로 ${manifestPath}로 이동하세요` });
  for (const hook of hooks) {
    const path = hookPath(hook.name);
    const missingRegistration = targetApps.some(app => !hook.registered[app]);
    if (hook.name !== 'verifierGate' && (hook.file === 'missing' || missingRegistration)) issues.push({ level: 'warn', path, message: `${hook.name}: 파일 또는 등록(${targetApps.join('·')})이 없습니다. plan으로 설치 목록을 확인하세요` });
    if (hook.file === 'legacy') issues.push({ level: 'warn', path, message: `${hook.name}: 이전 위치(${legacyHooksDir})에 있습니다. plan·apply로 이동하세요` });
    if (hook.file === 'different') issues.push({ level: 'warn', path, message: `${hook.name}: 번들과 다릅니다. 사용자 수정 여부를 비교하세요` });
    if (hook.configuration === 'legacy') issues.push({ level: 'warn', path: configPath(legacyHooksDir, hook.name), message: `${hook.name}: 설정 파일이 이전 위치에 있어 새 위치의 훅이 읽지 못합니다. plan·apply로 이동하세요` });
    for (const dir of [hooksDir, legacyHooksDir]) {
      const config = safePath(root, configPath(dir, hook.name));
      if (!existsSync(config)) continue;
      try {
        const parsed = JSON.parse(readFileSync(config, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        if (hook.name === 'branchGuard' && parsed.protectedBranches != null &&
            (!Array.isArray(parsed.protectedBranches) || parsed.protectedBranches.some(b => typeof b !== 'string'))) throw new Error();
        if (hook.name === 'verifierGate' && (!Array.isArray(parsed.checks) || !parsed.checks.length ||
            parsed.checks.some(c => !c || typeof c.command !== 'string' || !c.command.trim() || typeof c.name !== 'string'))) throw new Error();
      } catch { issues.push({ level: 'error', path: config, message: '훅 설정 형식이 잘못되었습니다. 값을 출력하지 않고 파일 위치만 표시합니다' }); }
    }
  }
  return { root, bundleVersion: version(), installedVersion: Object.keys(manifest.files).length ? manifest.version ?? null : null, nodeVersion: process.version, branch,
    apps: manifest.apps ?? null, detectedApps: detectApps(root), hooks, files, trackedFiles: Object.keys(manifest.files).length, issues,
    note: '등록 여부는 앱별 등록 파일 기준입니다. 현재 앱의 훅 실행 지원 여부(codex는 hooks 기능 활성·프로젝트 신뢰)는 별도 확인이 필요합니다.' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, project = '.', ...args] = process.argv.slice(2);
    const value = flag => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
    const allowed = { status: ['--json'], plan: ['--json', '--out', '--mode', '--profile', '--verifier', '--only', '--app'], apply: ['--plan'], rollback: ['--backup'] };
    if (!allowed[command]) throw new Error('사용법: harnessManager.mjs status|plan|apply|rollback <프로젝트> [옵션]');
    for (let i = 0; i < args.length; i++) {
      if (!allowed[command].includes(args[i])) throw new Error(`알 수 없는 옵션: ${args[i]}`);
      if (!['--json', '--verifier'].includes(args[i]) && (!args[++i] || args[i].startsWith('--'))) throw new Error('옵션 값이 필요합니다');
    }
    if (command === 'status') {
      const result = await status(project);
      if (args.includes('--json')) console.log(json(result));
      else {
        console.log(`번들 ${result.bundleVersion} / 설치 ${result.installedVersion ?? '추적 기록 없음'} / 앱 ${(result.apps ?? result.detectedApps).join('·')}${result.apps ? '' : ' (추정)'} / 브랜치 ${result.branch ?? '없음'}`);
        for (const hook of result.hooks) {
          const registered = appNames.map(app => `${app} ${hook.registered[app] ? '있음' : '없음'}`).join(' · ');
          console.log(`${hook.name}: 파일 ${hook.file}, 등록 ${registered}, 설정 ${hook.configuration}`);
        }
        for (const file of result.files.filter(file => file.state !== 'current')) console.log(`${file.path}: ${file.state} (설치 ${file.installedVersion ?? '알 수 없음'})`);
        for (const issue of result.issues) console.log(`${issue.level}: ${issue.message}`);
        console.log(result.note);
      }
      process.exitCode = result.issues.some(i => i.level === 'error') ? 1 : 0;
    } else if (command === 'plan') {
      const result = createPlan(project, { mode: value('--mode'), profile: value('--profile'), verifier: args.includes('--verifier') ? true : undefined, only: value('--only')?.split(','), app: value('--app') });
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
