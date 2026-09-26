#!/usr/bin/env node
// 번들 자산만 추적한다. 도메인 스킬·사용자 기록·개인 설정은 관리 대상이 아니다.
// 파일 소유권 (docs/design/2026-09-21-scaffold.md):
//   코어 파일   — 훅 스크립트, 코어 규칙 사본(.agents/harness-core-rules.md). 미수정이면 교체, 수정됐으면 충돌. eject로 소유 전환.
//   공동 파일   — 문서 템플릿, 앱 등록 파일. 템플릿은 팀이 고쳤으면 원본 사본(.agents/harness-base/)과 3-way 병합. 등록 파일은 이 도구가 넣은 부분만 갱신.
//   프로젝트 파일 — 팀 규칙(docs/harness-rules.md), 규칙 포인터(CLAUDE.md·AGENTS.md), CI 워크플로(--ci). 없을 때 한 번 만들고 이후 건드리지 않는다.
// 팀 묶음(export/import): 팀이 소유·수정한 파일만 한 JSON으로 묶어 다른 저장소로 옮긴다. 코어 파일·추적 기록·백업·사본은 제외한다.
// 팀 구성 명세(.agents/harness-team.json)는 teamCompose.mjs가 만들고 훅 설정값·규칙 문서의 생성 구간을 그 명세에서 만든다.
//   이 파일은 명세를 프로젝트 파일(팀 소유)로 보고 묶음·복원 대상에만 넣는다 (docs/design/2026-09-26-team-compose.md).
// 관리 파일(훅·추적 기록·백업)은 앱 중립 위치 .agents/에 둔다. 훅 등록만 앱별 파일에 쓴다:
//   claude → .claude/settings.json (hooks + permissions.deny), codex → .codex/hooks.json (hooks)
// v2.x(.claude/hooks/·.claude/harness-install.json)와 v3.x(docs/harness-rules.md를 코어 사본으로 추적)는 업데이트 계획에서 변환한다.
import { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync, renameSync, unlinkSync, readdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateHarness } from './validateHarness.mjs';

export const bundleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const hooksDir = '.agents/hooks';
const legacyHooksDir = '.claude/hooks';
const manifestPath = '.agents/harness-install.json';
const legacyManifestPath = '.claude/harness-install.json';
const backupDir = '.agents/harness-backups';
export const baseDir = '.agents/harness-base'; // 3-way 병합용 원본 사본. 커밋한다 — 팀원 모두가 같은 원본 기준을 가져야 한다
export const ciWorkflowPath = '.github/workflows/harness-check.yml';
const ciAsset = 'skills/harness/assets/harness-check.yml';
const templateDir = 'docs/templates/';
const basePathOf = path => `${baseDir}/${path}`;
export const coreRulesPath = '.agents/harness-core-rules.md';
export const teamRulesPath = 'docs/harness-rules.md';
export const teamSpecPath = '.agents/harness-team.json'; // 팀 구성 명세(teamCompose.mjs). 팀 소유 · 커밋한다
const rulesAsset = 'skills/harness/assets/harness-rules.md';
const teamRulesAsset = 'skills/harness/assets/harness-team-rules.md';
const pointerAsset = 'skills/harness/assets/pointer.md';
// 앱별 훅 등록 파일과 규칙 포인터 파일. signals는 --app 생략 시 프로젝트에서 앱을 추정하는 단서다.
const apps = {
  claude: { registry: '.claude/settings.json', pointer: 'CLAUDE.md', signals: ['.claude', 'CLAUDE.md'] },
  codex: { registry: '.codex/hooks.json', pointer: 'AGENTS.md', signals: ['.codex', 'AGENTS.md', '.agents/skills', '.agents/plugins'] },
};
const appNames = Object.keys(apps);
export const hash = value => value == null ? null : createHash('sha256').update(value).digest('hex');
export const json = value => `${JSON.stringify(value, null, 2)}\n`;
export const read = path => existsSync(path) ? readFileSync(path, 'utf8') : null;
const parse = (text, fallback) => text == null ? fallback : JSON.parse(text);
export const version = () => JSON.parse(readFileSync(join(bundleRoot, '.claude-plugin/plugin.json'), 'utf8')).version;
const hookNames = ['blockGitMutation', 'blockSecretAccess', 'branchGuard'];
const allHookNames = [...hookNames, 'verifierGate'];
const deny = ['Read(./.env)', 'Read(./.env.*)', 'Read(./**/credentials*)', 'Read(./**/*.pem)', 'Read(./**/secrets/**)'];
export const hookPath = name => `${hooksDir}/${name}.mjs`;
const legacyHookPath = name => `${legacyHooksDir}/${name}.mjs`;
export const configPath = (dir = hooksDir, name) => `${dir}/${name}.config.json`;
// teamCompose.mjs가 쓰는 앱별 등록·포인터 경로. 읽기 전용 사본이다.
export const appFiles = () => structuredClone(apps);
// 새 minimal 설치가 만드는 Git 훅 설정의 초기값. import는 이 값 그대로인 파일을 init 초기 상태로 본다.
const minimalGitConfig = json({ allowCommitPush: false, requireHistoryDoc: false });
const hookSource = name => `skills/harness/assets/hooks/${name}.mjs`;
const countRules = content => content.split('\n').filter(line => /^\d+\.\s+\*\*/.test(line)).length;

// 계획·설치 기록에서 읽은 경로도 프로젝트 밖이나 심볼릭 링크를 따라가지 않는다.
export function safePath(root, path) {
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
// 추적하는 번들 파일(코어·공동). 프로젝트 파일은 포함하지 않는다.
function catalog({ profile = 'minimal', verifier = false } = {}) {
  if (!['minimal', 'basic', 'collaboration'].includes(profile)) throw new Error('profile은 minimal, basic 또는 collaboration입니다');
  const files = {};
  for (const name of [...hookNames, ...(verifier ? ['verifierGate'] : [])]) files[hookPath(name)] = hookSource(name);
  files[coreRulesPath] = rulesAsset;
  for (const name of profile === 'minimal' ? [] : ['history', 'handoff', ...(profile === 'collaboration' ? ['retro', 'loop-spec'] : [])]) {
    files[`docs/templates/${name}.md`] = `skills/history/assets/templates/${name}.md`;
  }
  return files;
}
// 프로젝트 파일: 없을 때만 만든다. 추적하지 않으며 업데이트·제거에서 건드리지 않는다.
function projectFiles(selectedApps, { ci = false } = {}) {
  const files = { [teamRulesPath]: teamRulesAsset };
  for (const app of selectedApps) files[apps[app].pointer] = pointerAsset;
  if (ci) files[ciWorkflowPath] = ciAsset;
  return files;
}
const templatePaths = [...Object.keys(catalog({ profile: 'collaboration' }))].filter(path => path.startsWith(templateDir));

// 3-way 병합: 팀 수정본(ours)·설치 시점 원본(base)·새 원본(theirs). git merge-file이 겹침 없이 합치면 결과를,
// 겹치면(종료 코드 = 충돌 수) conflict를, git이 없으면 error를 돌려준다. 결과는 결정적이라 계획 재계산과 일치한다.
export function mergeThreeWay({ ours, base, theirs }) {
  const dir = mkdtempSync(join(tmpdir(), 'harness-merge-'));
  try {
    const files = { ours, base, theirs };
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    try {
      const merged = execFileSync('git', ['merge-file', '-p', '-L', '팀 수정본', '-L', '설치 원본', '-L', '새 버전', join(dir, 'ours'), join(dir, 'base'), join(dir, 'theirs')],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { merged };
    } catch (error) {
      if (typeof error.status === 'number' && error.status > 0 && error.status < 128) return { conflict: true };
      return { error: 'git merge-file을 실행할 수 없습니다' };
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const allPaths = new Set(Object.keys(catalog({ profile: 'collaboration', verifier: true })));
export const corePaths = new Set([...allHookNames.map(hookPath), coreRulesPath]);
const legacyPaths = new Set([...allHookNames.map(legacyHookPath), teamRulesPath]);
// 복원 대상으로 인정하는 경로: 번들 파일, 이전 위치 파일, 훅 설정(이동), 등록 파일, 추적 기록, 프로젝트 파일(최초 생성).
const restorablePaths = new Set([
  ...allPaths, ...legacyPaths, manifestPath, legacyManifestPath, teamRulesPath, ciWorkflowPath,
  ...templatePaths.map(basePathOf),
  ...appNames.flatMap(app => [apps[app].registry, apps[app].pointer]),
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
  manifest.ejected ??= [];
  if (!Array.isArray(manifest.ejected) || manifest.ejected.some(path => !corePaths.has(path))) throw new Error('설치 기록의 eject 항목이 잘못되었습니다');
  return { manifest, legacyManifest: legacy };
}
export function isInstalled(project) {
  const root = realpathSync(project);
  return Object.keys(loadManifest(root).manifest.files).length > 0;
}
// 설치 기록의 읽기 전용 사본(버전·프로필·verifier·앱·추적 파일). teamCompose.mjs가 기존 설치 상태를 근거로 쓴다.
export function readManifest(project) {
  const root = realpathSync(project);
  const { manifest, legacyManifest } = loadManifest(root);
  return { ...structuredClone(manifest), legacyManifest, installed: Object.keys(manifest.files).length > 0 };
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
export function atomicWrite(path, content) {
  if (content == null) { if (existsSync(path)) unlinkSync(path); return; }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  const mode = existsSync(path) ? lstatSync(path).mode & 0o777 : 0o600;
  writeFileSync(tmp, content, { mode });
  renameSync(tmp, path);
}
// 변경 묶음을 백업 한 건과 함께 쓴다. changes: [{ path, before, after }] (after가 null이면 삭제).
// 쓰기 도중 실패하면 이미 쓴 파일을 이전 내용으로 되돌린다. 백업은 rollback()이 읽는 형식이다.
export function commitChanges(root, changes) {
  if (!changes.length) return { changed: 0, backup: null };
  const records = changes.map(change => ({ path: change.path, before: change.before, afterHash: hash(change.after) }));
  const backup = `${backupDir}/${randomUUID()}.json`;
  atomicWrite(safePath(root, backup), json({ schemaVersion: 1, root, records }));
  try {
    for (const change of changes) atomicWrite(safePath(root, change.path), change.after);
  } catch (error) {
    for (const record of [...records].reverse()) atomicWrite(safePath(root, record.path), record.before);
    throw error;
  }
  return { changed: changes.length, backup };
}

export function createPlan(project, options = {}) {
  const root = realpathSync(project);
  const { manifest: previous, legacyManifest } = loadManifest(root);
  const mode = options.mode ?? 'update';
  if (!['update', 'remove'].includes(mode)) throw new Error('mode는 update 또는 remove입니다');
  const profile = options.profile ?? previous.profile ?? (Object.keys(previous.files).length ? 'basic' : 'minimal');
  const verifier = options.verifier ?? previous.verifier ?? false;
  const only = options.only ?? null;
  if (only != null && (!Array.isArray(only) || only.some(p => !allPaths.has(p)))) throw new Error('only에는 번들 관리 경로만 지정하세요');
  const selectedApps = resolveApps(options.app ?? null, previous, root);
  const ci = options.ci === true;
  const request = { mode, profile, verifier, only, app: options.app ?? null, ci };
  const next = structuredClone(previous);
  Object.assign(next, { version: version(), profile, verifier, apps: selectedApps });
  const operations = [];
  const add = (path, action, before, after, reason) => operations.push({ path, action, beforeHash: hash(before), after, reason });
  const selected = path => only == null || only.includes(path);
  const target = catalog({ profile, verifier });
  // 프로필을 줄여도 이미 관리 중인 양식은 계속 갱신한다. 기록·팀 수정본을 잃지 않는다.
  const completeCatalog = catalog({ profile: 'collaboration', verifier: true });
  for (const path of Object.keys(previous.files)) {
    if (path.startsWith(templateDir)) target[path] = completeCatalog[path];
  }
  for (const path of previous.ejected) delete target[path]; // eject한 코어 파일은 프로젝트 소유 — 갱신하지 않는다
  const activeHooks = [...hookNames, ...(verifier ? ['verifierGate'] : [])];
  for (const [path, source] of Object.entries(mode === 'remove' ? previous.files : target)) {
    if (!selected(legacyPaths.has(path) ? path.replace(legacyHooksDir, hooksDir) : path)) continue;
    const before = read(safePath(root, path));
    const tracked = previous.files[path];
    if (mode === 'remove') {
      // 문서와 사용자 기록은 제거해도 보존한다. 추적만 해제한다. 병합 원본 사본은 도구 소유라 지운다.
      if (path.startsWith(templateDir)) {
        const base = read(safePath(root, basePathOf(path)));
        if (base != null) add(basePathOf(path), 'delete', base, null, '병합 원본 사본 제거');
      }
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
    if (path.startsWith(templateDir)) {
      // 공동 파일(템플릿): 팀 수정본은 설치 원본 사본과 3-way 병합한다. 사본이 없는 설치본(v4.0 이하)은 수정본을 보존하고 사본부터 등록한다.
      const basePath = basePathOf(path);
      const base = read(safePath(root, basePath));
      const track = content => { next.files[path] = { hash: hash(content), version: version() }; };
      const setBase = () => { if (base !== after) add(basePath, base == null ? 'create' : 'update', base, after, '병합 원본 사본'); };
      if (before === after) { track(after); add(path, tracked ? 'unchanged' : 'adopt', before, after, tracked ? '최신 파일' : '번들과 동일한 기존 파일을 추적'); setBase(); continue; }
      if (before == null) { track(after); add(path, 'create', null, after, '번들 파일 적용'); setBase(); continue; }
      if (!tracked) { add(path, 'conflict', before, before, '출처를 확인할 수 없는 기존 파일 · 보존'); continue; }
      // 미수정 판정은 설치 원본 사본과의 일치다. 추적 해시는 병합 결과도 가리키므로 그것만으로는 팀 수정을 놓친다.
      const pristine = base != null ? before === base : hash(before) === tracked.hash;
      if (pristine) { track(after); add(path, 'update', before, after, '번들 파일 적용'); setBase(); continue; }
      if (base == null) { track(before); add(path, 'preserve', before, before, '팀 수정본 보존 · 병합 원본 사본을 등록해 다음 업데이트부터 3-way 병합'); setBase(); continue; }
      if (base === after) { track(before); add(path, 'unchanged', before, before, '팀 수정본 · 새 버전과 원본이 같아 병합할 것 없음'); continue; }
      const result = mergeThreeWay({ ours: before, base, theirs: after });
      if (result.merged != null) { track(result.merged); add(path, result.merged === before ? 'unchanged' : 'merge', before, result.merged, '팀 수정과 새 버전을 3-way 병합'); setBase(); continue; }
      add(path, 'conflict', before, before, result.conflict ? '팀 수정과 새 버전이 같은 곳을 바꿈 · 직접 병합한 뒤 다시 실행' : `${result.error} · 보존`);
      continue;
    }
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
  if (mode === 'update') {
    // v3.x는 docs/harness-rules.md를 코어 사본으로 추적했다. v4부터 그 경로는 팀 규칙(프로젝트 파일)이다.
    // 원본 그대로면 팀 규칙 형식으로 바꾸고, 팀이 고쳤으면 그대로 두고 추적만 해제한다(status가 정리 방법을 안내한다).
    const trackedRules = previous.files[teamRulesPath];
    if (trackedRules && selected(coreRulesPath)) {
      const before = read(safePath(root, teamRulesPath));
      delete next.files[teamRulesPath];
      if (before != null && hash(before) === trackedRules.hash) {
        add(teamRulesPath, 'update', before, readFileSync(join(bundleRoot, teamRulesAsset), 'utf8'), `팀 규칙 파일로 전환 · 코어 규칙은 ${coreRulesPath}`);
      } else if (before != null) {
        add(teamRulesPath, 'preserve', before, before, `팀이 수정한 규칙 파일 보존 · 추적 해제. 코어 규칙 7개를 지우고 ${coreRulesPath} 포인터를 남기세요`);
      }
    }
    // 새 minimal 설치만 기록 게이트를 명시적으로 끈다. 기존 설치·수동 훅의 암묵적 정책은 보존한다.
    const gitConfig = configPath(hooksDir, 'blockGitMutation');
    if (profile === 'minimal' && Object.keys(previous.files).length === 0 &&
        read(safePath(root, hookPath('blockGitMutation'))) == null &&
        read(safePath(root, legacyHookPath('blockGitMutation'))) == null &&
        read(safePath(root, configPath(legacyHooksDir, 'blockGitMutation'))) == null &&
        read(safePath(root, gitConfig)) == null) {
      add(gitConfig, 'create', null, minimalGitConfig, '새 최소 구성 · 기록 게이트 선택 사용');
    }
    // 프로젝트 파일은 없을 때만 만든다.
    for (const [path, source] of Object.entries(projectFiles(selectedApps, { ci }))) {
      if (operations.some(op => op.path === path)) continue;
      if (read(safePath(root, path)) == null) add(path, 'create', null, readFileSync(join(bundleRoot, source), 'utf8'), '프로젝트 파일 · 최초 생성 후 관리하지 않음');
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
  const root = realpathSync(plan.root);
  const changes = plan.operations.filter(op => hash(op.after) !== op.beforeHash)
    .map(op => ({ path: op.path, before: read(safePath(root, op.path)), after: op.after }));
  return commitChanges(root, changes);
}
export function rollback(project, backup) {
  const root = realpathSync(project);
  if (!/^\.(?:agents|claude)\/harness-backups\/[a-f0-9-]+\.json$/.test(backup)) throw new Error('허용되지 않는 백업 경로입니다');
  const data = JSON.parse(readFileSync(safePath(root, backup), 'utf8'));
  if (data.root !== root || data.schemaVersion !== 1 || !Array.isArray(data.records)) throw new Error('다른 프로젝트 또는 잘못된 백업입니다');
  for (const record of data.records) {
    if (!restorablePaths.has(record.path) && !presetKind(record.path)) throw new Error('백업에 알 수 없는 파일이 있습니다');
    if (hash(read(safePath(root, record.path))) !== record.afterHash) throw new Error(`적용 후 수정된 파일은 복원하지 않습니다: ${record.path}`);
  }
  for (const record of [...data.records].reverse()) atomicWrite(safePath(root, record.path), record.before);
  return { restored: data.records.length };
}
// 코어 파일 하나를 프로젝트 소유로 전환한다. 파일은 그대로 두고 추적만 해제하며, 이후 업데이트·제거에서 건드리지 않는다.
// 되돌리려면 파일을 지우고 update를 실행한다(다시 코어 파일로 생성·추적된다).
export function eject(project, path) {
  const root = realpathSync(project);
  if (!corePaths.has(path)) throw new Error(`eject는 코어 파일에만 쓸 수 있습니다: ${[...corePaths].join(', ')}`);
  const { manifest } = loadManifest(root);
  if (!manifest.files[path]) throw new Error(`추적 중인 파일이 아닙니다: ${path}`);
  if (read(safePath(root, path)) == null) throw new Error(`파일이 없습니다: ${path}`);
  const next = structuredClone(manifest);
  delete next.files[path];
  if (!next.ejected.includes(path)) next.ejected.push(path);
  const before = read(safePath(root, manifestPath));
  const backup = `${backupDir}/${randomUUID()}.json`;
  atomicWrite(safePath(root, backup), json({ schemaVersion: 1, root, records: [{ path: manifestPath, before, afterHash: hash(json(next)) }] }));
  atomicWrite(safePath(root, manifestPath), json(next));
  return { ejected: path, backup };
}
// ── 팀 묶음: 팀이 소유하거나 고친 파일만 모은다 ────────────────────────────────
// 포함: 팀 규칙, 훅 설정값, 팀 훅(코어 이름이 아닌 .mjs), 팀 스킬(.claude/skills·.agents/skills), 팀이 고친 템플릿, CI 워크플로.
// 제외: 코어 훅·코어 규칙 사본(update가 준다), 규칙 포인터(프로젝트 이름이 들어간다), 추적 기록·백업·사본, 작업 기록.
const coreHookFiles = new Set(allHookNames.map(hookPath));
const skillRoots = ['.claude/skills', '.agents/skills'];
const presetRules = [
  { test: path => path === teamRulesPath, why: '팀 규칙' },
  { test: path => path === teamSpecPath, why: '팀 구성 명세' },
  { test: path => path === ciWorkflowPath, why: 'CI 워크플로' },
  { test: path => /^\.agents\/hooks\/[\w.-]+\.config\.json$/.test(path), why: '훅 설정값' },
  { test: path => /^\.agents\/hooks\/[\w.-]+\.mjs$/.test(path) && !coreHookFiles.has(path), why: '팀 훅' },
  { test: path => templatePaths.includes(path), why: '문서 템플릿(팀 수정본)' },
  { test: path => skillRoots.some(rootDir => path.startsWith(`${rootDir}/`)) && /\/[\w-]+\/(SKILL\.md|(scripts|references|assets)\/[\w./-]+)$/.test(path) && !path.includes('..'), why: '팀 스킬' },
];
const presetKind = path => presetRules.find(rule => rule.test(path))?.why ?? null;
const listFiles = (root, dir) => {
  const out = [];
  const walk = rel => {
    const abs = safePath(root, rel);
    if (!existsSync(abs) || !lstatSync(abs).isDirectory()) return;
    for (const name of readdirSync(abs).sort()) {
      const child = `${rel}/${name}`;
      const stat = lstatSync(join(abs, name));
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(child); else out.push(child);
    }
  };
  walk(dir);
  return out;
};
export function exportPreset(project) {
  const root = realpathSync(project);
  const { manifest } = loadManifest(root);
  const candidates = new Set([teamRulesPath, teamSpecPath, ciWorkflowPath, ...listFiles(root, hooksDir), ...skillRoots.flatMap(dir => listFiles(root, dir)), ...templatePaths]);
  const files = {};
  const skipped = [];
  for (const path of [...candidates].sort()) {
    const content = read(safePath(root, path));
    if (content == null) continue;
    const kind = presetKind(path);
    if (!kind) { skipped.push(path); continue; }
    if (templatePaths.includes(path)) {
      // 템플릿은 팀이 고친 것만 담는다. 원본 그대로면 같은 프로필의 init·update가 준다.
      const base = read(safePath(root, basePathOf(path)));
      const pristine = base != null ? content === base : content === readFileSync(join(bundleRoot, catalog({ profile: 'collaboration' })[path]), 'utf8');
      if (pristine) continue;
    }
    if (/\.(state|tmp)\b/.test(path)) continue;
    files[path] = content;
  }
  return { schemaVersion: 1, tool: 'guksu-harness', bundleVersion: version(), sourceVersion: manifest.version ?? null, files, skipped };
}
// init이 만든 뒤 손대지 않은 파일인가 — 템플릿은 사본(없으면 번들)과, 팀 규칙·CI 워크플로·minimal의 Git 설정은 초기값과 같으면 그렇다.
// 이런 파일은 덮어써도 잃는 것이 없으므로 force 없이 가져온다.
const untouched = (root, path, content) => {
  if (templatePaths.includes(path)) {
    const base = read(safePath(root, basePathOf(path)));
    return content === (base ?? readFileSync(join(bundleRoot, catalog({ profile: 'collaboration' })[path]), 'utf8'));
  }
  if (path === teamRulesPath) return content === readFileSync(join(bundleRoot, teamRulesAsset), 'utf8');
  if (path === ciWorkflowPath) return content === readFileSync(join(bundleRoot, ciAsset), 'utf8');
  if (path === configPath(hooksDir, 'blockGitMutation')) return content === minimalGitConfig;
  return false;
};
// 가져오기: 허용된 종류의 경로만 쓴다. 이미 있고 내용이 다른 파일은 force가 아니면 건너뛰고 보고한다(init 초기 상태 그대로인 파일은 예외).
export function importPreset(project, preset, { force = false } = {}) {
  const root = realpathSync(project);
  if (preset?.schemaVersion !== 1 || preset.tool !== 'guksu-harness' || !preset.files || typeof preset.files !== 'object' || Array.isArray(preset.files)) {
    throw new Error('지원하지 않는 묶음 파일입니다');
  }
  const written = [], skipped = [], rejected = [];
  const records = [];
  const updates = { ...preset.files };
  const { manifest, legacyManifest } = loadManifest(root);
  const manifestFile = legacyManifest ? legacyManifestPath : manifestPath;
  const manifestBefore = read(safePath(root, manifestFile));
  if (manifestBefore == null) throw new Error('먼저 init을 실행하세요');
  for (const [path, content] of Object.entries(preset.files)) {
    if (typeof content !== 'string' || !presetKind(path)) { rejected.push(path); continue; }
    let target;
    try { target = safePath(root, path); } catch { rejected.push(path); continue; }
    const before = read(target);
    if (before === content) continue;
    if (before != null && !force && !untouched(root, path, before)) { skipped.push(path); continue; }
    records.push({ path, before, afterHash: hash(content) });
    written.push(path);
  }
  // minimal에 처음 가져오는 양식도 팀 수정본으로 추적한다. 현재 번들을 다음 병합의 기준으로 저장한다.
  for (const path of written.filter(path => templatePaths.includes(path) && !manifest.files[path])) {
    const basePath = basePathOf(path);
    const base = read(safePath(root, basePath));
    if (base == null) {
      updates[basePath] = readFileSync(join(bundleRoot, catalog({ profile: 'collaboration' })[path]), 'utf8');
      records.push({ path: basePath, before: null, afterHash: hash(updates[basePath]) });
    }
    manifest.files[path] = { hash: hash(updates[path]), version: version() };
  }
  if (json(manifest) !== manifestBefore && written.some(path => templatePaths.includes(path))) {
    updates[manifestFile] = json(manifest);
    records.push({ path: manifestFile, before: manifestBefore, afterHash: hash(updates[manifestFile]) });
  }
  const { backup } = commitChanges(root, records.map(record => ({ path: record.path, before: record.before, after: updates[record.path] })));
  return { written, skipped, rejected, backup };
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
    const file = manifest.ejected.includes(hookPath(name)) ? 'ejected'
      : content == null ? (legacyContent == null ? 'missing' : 'legacy') : content === expected ? 'current' : 'different';
    return { name, file, registered, configuration,
      note: name === 'verifierGate' ? '설정 없으면 비활성 · Stop에서만 검사' : '훅 이벤트를 지원하는 앱(claude·codex)에서만 적용' };
  });
  let branch = null;
  try { branch = execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* 비 git 프로젝트 */ }
  const all = { ...catalog({ profile: 'collaboration', verifier: true }), [teamRulesPath]: rulesAsset };
  const files = Object.entries(manifest.files).map(([path, entry]) => {
    const content = read(safePath(root, path));
    const expected = readFileSync(join(bundleRoot, all[path] ?? all[path.replace(legacyHooksDir, hooksDir)]), 'utf8');
    const isTemplate = path.startsWith(templateDir);
    const base = isTemplate ? existsSync(safePath(root, basePathOf(path))) : undefined;
    const state = content == null ? 'missing'
      : hash(content) !== entry.hash ? 'modified'
      : legacyPaths.has(path) ? 'legacy-location'
      : content === expected ? 'current'
      : isTemplate && base && content !== read(safePath(root, basePathOf(path))) ? 'customized' // 팀 수정이 반영된 추적본 — 다음 업데이트 때 3-way 병합
      : 'update-available';
    return { path, installedVersion: entry.version ?? null, state, ...(isTemplate ? { base: base ? 'present' : 'missing' } : {}) };
  });
  const issues = await validateHarness({ rootDir: root });
  if (legacyManifest) issues.push({ level: 'warn', path: legacyManifestPath, message: `설치 기록이 이전 위치에 있습니다. update로 ${manifestPath}로 이동하세요` });
  if (manifest.files[teamRulesPath]) issues.push({ level: 'warn', path: teamRulesPath, message: `v3 구조입니다. update가 코어 규칙을 ${coreRulesPath}로 옮기고 이 파일을 팀 규칙 파일로 바꿉니다` });
  const teamRules = read(safePath(root, teamRulesPath));
  if (Object.keys(manifest.files).length && !manifest.files[teamRulesPath] && teamRules != null && countRules(teamRules) >= 7) {
    issues.push({ level: 'warn', path: teamRulesPath, message: `팀 규칙 파일에 코어 규칙 전문이 남아 있습니다. 코어 규칙은 ${coreRulesPath}가 정본이니 이 파일에는 포인터와 팀 규칙만 남기세요` });
  }
  for (const hook of hooks) {
    const path = hookPath(hook.name);
    const missingRegistration = targetApps.some(app => !hook.registered[app]);
    if (hook.name !== 'verifierGate' && (hook.file === 'missing' || missingRegistration)) issues.push({ level: 'warn', path, message: `${hook.name}: 파일 또는 등록(${targetApps.join('·')})이 없습니다. update로 설치 목록을 확인하세요` });
    if (hook.file === 'legacy') issues.push({ level: 'warn', path, message: `${hook.name}: 이전 위치(${legacyHooksDir})에 있습니다. update로 이동하세요` });
    if (hook.file === 'different') issues.push({ level: 'warn', path, message: `${hook.name}: 번들과 다릅니다. 사용자 수정 여부를 비교하세요. 의도한 수정이면 eject로 소유를 전환하세요` });
    if (hook.configuration === 'legacy') issues.push({ level: 'warn', path: configPath(legacyHooksDir, hook.name), message: `${hook.name}: 설정 파일이 이전 위치에 있어 새 위치의 훅이 읽지 못합니다. update로 이동하세요` });
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
    apps: manifest.apps ?? null, detectedApps: detectApps(root), hooks, files, ejected: manifest.ejected, trackedFiles: Object.keys(manifest.files).length, issues,
    note: '등록 여부는 앱별 등록 파일 기준입니다. 현재 앱의 훅 실행 지원 여부(codex는 hooks 기능 활성·프로젝트 신뢰)는 별도 확인이 필요합니다.' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, project = '.', ...args] = process.argv.slice(2);
    const value = flag => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; };
    const allowed = { status: ['--json'], plan: ['--json', '--out', '--mode', '--profile', '--verifier', '--only', '--app', '--ci'], apply: ['--plan'], rollback: ['--backup'] };
    if (!allowed[command]) throw new Error('사용법: harnessManager.mjs status|plan|apply|rollback <프로젝트> [옵션]');
    for (let i = 0; i < args.length; i++) {
      if (!allowed[command].includes(args[i])) throw new Error(`알 수 없는 옵션: ${args[i]}`);
      if (!['--json', '--verifier', '--ci'].includes(args[i]) && (!args[++i] || args[i].startsWith('--'))) throw new Error('옵션 값이 필요합니다');
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
        for (const path of result.ejected) console.log(`${path}: ejected (프로젝트 소유)`);
        for (const issue of result.issues) console.log(`${issue.level}: ${issue.message}`);
        console.log(result.note);
      }
      process.exitCode = result.issues.some(i => i.level === 'error') ? 1 : 0;
    } else if (command === 'plan') {
      const result = createPlan(project, { mode: value('--mode'), profile: value('--profile'), verifier: args.includes('--verifier') ? true : undefined, only: value('--only')?.split(','), app: value('--app'), ci: args.includes('--ci') });
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
