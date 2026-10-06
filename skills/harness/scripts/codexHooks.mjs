// Explicit read-only app-server queries. No threads, model turns, hook execution or trust writes.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { resolveProjectRoot } from './workspaces.mjs';

const object = value => value != null && typeof value === 'object' && !Array.isArray(value);
const canonical = path => { try { return realpathSync(path); } catch { return resolve(path); } };
const digest = text => createHash('sha256').update(text).digest('hex');
const failure = (code, method = null) => Object.assign(new Error(code), { code, method });
const allowedMethods = new Set(['initialize', 'config/read', 'hooks/list', 'experimentalFeature/list']);
const explanations = {
  'registry-missing': 'Codex 등록 파일이 없음', 'invalid-registry': 'Codex 등록 파일 형식 오류',
  'project-layer-missing': '프로젝트 설정 계층이 발견되지 않음', 'project-layer-disabled': '프로젝트 설정 계층이 비활성 — 프로젝트 신뢰·관리 정책 확인',
  'hook-review-required': '훅 정의의 신뢰 검토 필요 — Codex /hooks에서 검토', 'hook-disabled': '개별 훅이 비활성',
  'hook-missing': '등록한 훅과 앱이 발견한 훅이 일치하지 않음', 'hook-unknown': '훅 상태를 판정할 수 없음',
  'hooks-disabled': '훅 기능이 비활성 — 사용자·관리 설정 확인', 'hooks-feature-unknown': '훅 기능의 활성 상태를 확인하지 못함',
  'discovery-errors': '앱의 훅 탐색 오류', 'discovery-warnings': '앱의 훅 탐색 경고', 'registry-empty': '등록한 훅이 없음',
  'cli-missing': 'Codex CLI를 찾지 못함', 'cli-version-unavailable': 'Codex CLI 버전 조회 실패',
  'unsupported-method': '이 CLI는 필요한 조회 API를 지원하지 않음', 'unsupported-registry': '지원하지 않는 등록 형식',
  timeout: '앱 서버 조회 시간 초과', interrupted: '조회가 중단됨', 'output-limit': '앱 서버 응답 크기 초과',
};
export const describeCodexPreflight = report => report.ready
  ? '등록·활성·신뢰 조건 확인. 실제 훅 실행은 별도 시험이 필요하다'
  : report.reasons.map(reason => explanations[reason] ?? '앱 서버 응답을 확인하지 못함').join(' / ');

function connection(cwd, timeoutMs) {
  const child = spawn('codex', ['app-server', '--listen', 'stdio://'], { cwd, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  const decoder = new StringDecoder('utf8');
  let id = 0, buffer = '', bytes = 0, terminal = null, stopping = false;
  const kill = () => { try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {} };
  const abort = error => {
    terminal = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear(); kill();
  };
  const timer = setTimeout(() => abort(failure('timeout')), timeoutMs);
  const interrupted = () => abort(failure('interrupted'));
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  const closed = new Promise(resolveClosed => child.on('close', () => {
    if (!stopping && !terminal) abort(failure('server-exited'));
    resolveClosed();
  }));
  child.on('error', error => abort(failure(error.code === 'ENOENT' ? 'cli-missing' : 'server-start-failed')));
  child.stdin.on('error', () => { if (!stopping) abort(failure('transport-error')); });
  const count = chunk => { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) abort(failure('output-limit')); };
  child.stderr.on('data', count); // Never retain or print raw server/config output.
  child.stdout.on('data', chunk => {
    count(chunk); if (terminal) return;
    buffer += decoder.write(chunk);
    const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let response;
      try { response = JSON.parse(line); } catch { abort(failure('invalid-json')); return; }
      if (!object(response)) { abort(failure('invalid-response')); return; }
      if (response.method && response.id != null) {
        // Never grant a server-initiated permission, authentication or tool request.
        child.stdin.write(`${JSON.stringify({ id: response.id, error: { code: -32601, message: 'Read-only diagnostics client' } })}\n`);
        continue;
      }
      const request = pending.get(response.id);
      if (!request) continue;
      pending.delete(response.id);
      if (response.error) request.reject(failure(response.error.code === -32601 ? 'unsupported-method' : 'rpc-error', request.method));
      else if (!object(response.result)) request.reject(failure('invalid-response', request.method));
      else request.resolve(response.result);
    }
  });
  return {
    async request(method, params) {
      if (!allowedMethods.has(method)) throw failure('unsupported-client-method');
      if (terminal) throw terminal;
      const requestId = ++id;
      return new Promise((resolveRequest, reject) => {
        pending.set(requestId, { resolve: resolveRequest, reject, method });
        child.stdin.write(`${JSON.stringify({ id: requestId, method, params })}\n`);
      });
    },
    initialized() { child.stdin.write('{"method":"initialized"}\n'); },
    async close() {
      stopping = true; clearTimeout(timer);
      process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
      child.stdin.end();
      const hardStop = setTimeout(kill, 500);
      await closed; clearTimeout(hardStop);
    },
  };
}

export function assessCodexHooks({ cwd, root, registry, config, listing, feature }) {
  if (!object(config.config) || !Array.isArray(config.layers) || !Array.isArray(listing.data)) throw failure('invalid-response');
  const entries = listing.data.filter(entry => typeof entry?.cwd === 'string' && canonical(entry.cwd) === cwd);
  if (entries.length !== 1) throw failure('invalid-response');
  const entry = entries[0];
  if (!Array.isArray(entry.hooks) || !Array.isArray(entry.errors) || !Array.isArray(entry.warnings)) throw failure('invalid-response');
  const sources = config.layers.filter(layer => layer.name?.type === 'project' && typeof layer.name.dotCodexFolder === 'string' && canonical(layer.name.dotCodexFolder) === join(root, '.codex'));
  if (sources.length > 1 || sources.some(layer => layer.disabledReason != null && typeof layer.disabledReason !== 'string')) throw failure('invalid-response');
  const layerState = sources.length === 0 ? 'missing' : sources.some(layer => typeof layer.disabledReason === 'string' && layer.disabledReason.length > 0) ? 'disabled' : 'loaded';
  const reasons = [];
  if (layerState !== 'loaded') reasons.push(`project-layer-${layerState}`);
  if (entry.errors.length) reasons.push('discovery-errors');
  if (entry.warnings.length) reasons.push('discovery-warnings');
  const featureEnabled = typeof feature?.enabled === 'boolean' ? feature.enabled : null;
  if (featureEnabled !== true) reasons.push(featureEnabled === false ? 'hooks-disabled' : 'hooks-feature-unknown');
  const hooks = [];
  if (!object(registry.hooks)) throw failure('invalid-registry');
  const knownEvents = ['PreToolUse', 'PostToolUse', 'PermissionRequest', 'SessionStart', 'SessionEnd', 'Stop', 'UserPromptSubmit', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'Interrupt'];
  for (const [event, groups] of Object.entries(registry.hooks)) {
    if (!knownEvents.includes(event) || !Array.isArray(groups)) throw failure('unsupported-registry');
    for (const group of groups) {
      if (!Array.isArray(group?.hooks)) throw failure('invalid-registry');
      for (const handler of group.hooks) {
        if (handler?.type !== 'command' || typeof handler.command !== 'string') throw failure('unsupported-registry');
        const matches = entry.hooks.filter(hook => hook.source === 'project' && typeof hook.sourcePath === 'string'
          && canonical(hook.sourcePath) === join(root, '.codex/hooks.json') && hook.handlerType === 'command'
          && hook.eventName === event[0].toLowerCase() + event.slice(1) && (hook.matcher ?? null) === (group.matcher ?? null)
          && hook.command === handler.command && (hook.async ?? false) === (handler.async ?? false));
        const discovered = matches.length === 1 ? matches[0] : null;
        const trust = ['managed', 'trusted', 'untrusted', 'modified'].includes(discovered?.trustStatus) ? discovered.trustStatus : 'unknown';
        const enabled = typeof discovered?.enabled === 'boolean' ? discovered.enabled : null;
        const state = !discovered ? 'missing' : enabled === false ? 'disabled' : ['untrusted', 'modified'].includes(trust) ? 'review-required'
          : enabled === true && (trust === 'trusted' || (trust === 'managed' && discovered.isManaged === true)) ? 'ready' : 'unknown';
        if (state !== 'ready') reasons.push(`hook-${state}`);
        // Commands, matchers, source paths, user hooks and config values can contain sensitive data.
        hooks.push({ id: digest(JSON.stringify([event, group.matcher ?? null, handler.command, handler.async ?? false])).slice(0, 16), event, state, enabled, trust });
      }
    }
  }
  if (!hooks.length) reasons.push('registry-empty');
  return { projectLayer: layerState, featureEnabled, hooks, errorCount: entry.errors.length, warningCount: entry.warnings.length,
    reasons: [...new Set(reasons)], ready: reasons.length === 0 };
}

export async function inspectCodexHooks(project, { timeoutMs = 15000 } = {}) {
  const cwd = realpathSync(project), root = canonical(resolveProjectRoot(cwd));
  const base = { schema: 1, app: 'codex', evidence: 'app-server-discovery', cwd: relative(root, cwd) || '.', capturedAt: new Date().toISOString(),
    cliVersion: null, hookIntegration: 'unverified', ready: false };
  const path = join(root, '.codex/hooks.json');
  if (!existsSync(path)) return { ...base, status: 'unavailable', reasons: ['registry-missing'] };
  let registry;
  try { registry = JSON.parse(readFileSync(path, 'utf8')); } catch { return { ...base, status: 'unavailable', reasons: ['invalid-registry'] }; }
  const version = spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 2000, maxBuffer: 65536 });
  if (version.status !== 0) return { ...base, status: 'unavailable', reasons: [version.error?.code === 'ENOENT' ? 'cli-missing' : 'cli-version-unavailable'] };
  base.cliVersion = version.stdout.trim().slice(0, 256);
  const rpc = connection(cwd, Math.min(Math.max(timeoutMs, 100), 30000));
  try {
    await rpc.request('initialize', { clientInfo: { name: 'guksu_harness_diagnostics', version: '1.0.0' } });
    rpc.initialized();
    const config = await rpc.request('config/read', { cwd, includeLayers: true });
    const listing = await rpc.request('hooks/list', { cwds: [cwd] });
    let feature = null, cursor = null;
    const seen = new Set();
    for (let page = 0; page < 20; page++) {
      const result = await rpc.request('experimentalFeature/list', { limit: 100, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(result.data)) throw failure('invalid-response');
      feature = result.data.find(item => item.name === 'hooks') ?? feature;
      if (feature || result.nextCursor == null) break;
      if (typeof result.nextCursor !== 'string' || seen.has(result.nextCursor)) throw failure('invalid-pagination');
      cursor = result.nextCursor; seen.add(cursor);
    }
    const assessment = assessCodexHooks({ cwd, root, registry, config, listing, feature });
    return { ...base, ...assessment, status: assessment.ready ? 'ready' : 'attention' };
  } catch (error) {
    return { ...base, status: 'unavailable', reasons: [error.code ?? 'inspection-failed'], ...(error.method ? { method: error.method } : {}) };
  } finally { await rpc.close(); }
}
