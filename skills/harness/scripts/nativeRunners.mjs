// Explicit opt-in only: graph discovery can load a project's Nx plugins.
// Never install a runner or execute build/test tasks while constructing a plan.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const object = value => value && typeof value === 'object' && !Array.isArray(value);
const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0);
const fail = (message, incompleteInventory = false) => { throw Object.assign(new Error(message), { incompleteInventory }); };
const inside = path => !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
const safePath = value => typeof value === 'string' && value.length > 0 && !isAbsolute(value) && !/^[a-z]:/i.test(value) && !value.includes('\\') && !value.split('/').includes('..');

function validateGraph(projects, inventory) {
  const names = new Set();
  for (const project of projects) {
    if (typeof project.name !== 'string' || !project.name || names.has(project.name) || !safePath(project.path) || !strings(project.dependencies)) fail('프로젝트 그래프 형식을 확인하지 못했습니다');
    names.add(project.name);
  }
  if (projects.length !== inventory.projects.length) fail('정적 목록과 runner의 프로젝트 수가 다릅니다', true);
  for (const project of projects) {
    if (!inventory.projects.some(item => item.name === project.name && item.path === project.path)) fail('정적 목록과 runner의 프로젝트 이름·경로가 다릅니다', true);
    if (project.dependencies.some(name => !names.has(name))) fail('그래프에 알 수 없는 내부 의존 관계가 있습니다');
    const path = relative(inventory.root, realpathSync(join(inventory.root, project.path)));
    if (!inside(path)) fail('프로젝트 경로가 저장소 밖입니다');
  }
  return projects;
}

export function parseNxGraph(data) {
  const graph = data?.graph;
  if (!object(graph?.nodes) || !object(graph.dependencies)) fail('Nx graph JSON 형식을 확인하지 못했습니다');
  const external = new Set(Object.keys(graph.externalNodes ?? {}));
  return Object.entries(graph.nodes).map(([name, node]) => {
    const edges = graph.dependencies[name];
    if (node.name !== name || !Array.isArray(edges)) fail('Nx 프로젝트·의존 관계가 누락됐습니다');
    const dependencies = edges.map(edge => {
      if (edge?.source !== name || typeof edge.target !== 'string') fail('Nx 의존 관계 형식 오류');
      return edge.target;
    }).filter(target => !external.has(target));
    return { name, path: node.data?.root, dependencies: [...new Set(dependencies)] };
  });
}

export function parseTurboGraph(data) {
  if (!Array.isArray(data?.packages)) fail('Turbo ls JSON 형식을 확인하지 못했습니다');
  return data.packages.map(item => ({ name: item.name, path: item.path, dependencies: item.dependencies }));
}

function turboTargets(checks) {
  const tasks = new Set();
  for (const check of checks.filter(item => item.workspace)) {
    const match = /^(?:npm|pnpm|yarn|bun) (?:run )?([\w:-]+)$/.exec(check.command);
    if (!match) fail('Turbo 태스크로 대응할 수 없는 패키지 검증 명령이 있습니다');
    tasks.add(match[1]);
  }
  if (!tasks.size) fail('Turbo 태스크에 대응할 패키지 검증 명령이 없습니다');
  return [...tasks].sort();
}

function addTurboTaskEdges(data, projects) {
  if (!Array.isArray(data?.tasks) || !object(data.globalCacheInputs?.files)) fail('Turbo dry-run JSON 형식을 확인하지 못했습니다');
  const byName = new Map(projects.map(project => [project.name, project]));
  const ids = new Map();
  for (const task of data.tasks) {
    if (typeof task.taskId !== 'string' || ids.has(task.taskId) || !byName.has(task.package) || !strings(task.dependencies)) fail('Turbo 태스크 그래프를 확인하지 못했습니다');
    ids.set(task.taskId, task);
  }
  for (const task of data.tasks) for (const id of task.dependencies) {
    const dependency = ids.get(id);
    if (!dependency) fail('Turbo 태스크 의존 관계가 누락됐습니다');
    if (dependency.package !== task.package) {
      const project = byName.get(task.package);
      project.dependencies = [...new Set([...project.dependencies, dependency.package])];
    }
  }
  return Object.keys(data.globalCacheInputs.files);
}

export function nativeAffected(inventory, changes, checks) {
  const runner = inventory.runner;
  const queries = [];
  let version = null;
  try {
    if (!['nx', 'turbo'].includes(runner)) fail('지원하는 runner가 없습니다');
    // Package resolution starts at this project's node_modules. No npx or global fallback.
    const packageDir = join(inventory.root, 'node_modules', runner);
    if (!existsSync(join(packageDir, 'package.json'))) fail('프로젝트에 runner가 설치되지 않았습니다');
    const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
    version = typeof pkg.version === 'string' ? pkg.version : null;
    const entry = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[runner];
    if (!safePath(entry) || !version) fail('설치된 runner의 실행 경로·버전을 확인하지 못했습니다');
    const bin = realpathSync(resolve(packageDir, entry));
    if (!inside(relative(realpathSync(packageDir), bin))) fail('runner 실행 경로가 패키지 밖입니다');
    const env = { ...process.env, NX_DAEMON: 'false', NX_TUI: 'false', NX_INTERACTIVE: 'false', NX_CACHE_PROJECT_GRAPH: 'false',
      TURBO_TELEMETRY_DISABLED: '1', DO_NOT_TRACK: '1', CI: 'true', FORCE_COLOR: '0', NO_COLOR: '1',
      TURBO_SCM_BASE: changes.base, TURBO_SCM_HEAD: 'HEAD' };
    const query = (args, input = '') => {
      queries.push({ args });
      const result = spawnSync(process.execPath, [bin, ...args], { cwd: inventory.root, env, input, encoding: 'utf8', timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
      if (result.error || result.status !== 0) fail(`runner 조회 실패 (exit ${result.status ?? '?'}, ${result.signal ?? result.error?.code ?? 'error'})`);
      try { return JSON.parse(result.stdout); } catch { fail('runner 응답이 JSON이 아닙니다'); }
    };
    let projects, affected, globalFiles = [];
    if (runner === 'nx') {
      if (changes.files.some(file => /[\r\n]/.test(file))) fail('개행이 있는 경로를 Nx stdin에 전달할 수 없습니다');
      projects = validateGraph(parseNxGraph(query(['graph', '--print'])), inventory);
      affected = query(['show', 'projects', '--affected', '--json', '--stdin'], `${changes.files.join('\n')}\n`);
      if (!strings(affected)) fail('Nx affected JSON 형식을 확인하지 못했습니다');
    } else {
      const names = inventory.projects.map(item => item.name);
      if (names.some(name => !/^(?:@[\w.-]+\/)?[\w][\w.-]*$/.test(name))) fail('Turbo 선택 인자로 사용할 수 없는 패키지 이름입니다');
      projects = validateGraph(parseTurboGraph(query(['ls', ...names, '--output=json'])), inventory);
      // The package graph alone misses explicit cross-package task dependencies.
      globalFiles = addTurboTaskEdges(query(['run', ...turboTargets(checks), '--dry=json']), projects);
      const selection = query(['ls', '--affected', '--output=json']);
      if (!Array.isArray(selection?.packages?.items)) fail('Turbo affected JSON 형식을 확인하지 못했습니다');
      affected = selection.packages.items.map(item => {
        if (!projects.some(project => project.name === item.name && project.path === item.path)) fail('Turbo affected 프로젝트 경로가 다릅니다');
        return item.name;
      });
    }
    if (affected.some(name => !projects.some(project => project.name === name))) fail('affected 결과에 알 수 없는 프로젝트가 있습니다');
    if (changes.files.some(file => globalFiles.includes(file))) fail('Turbo 공통 입력 파일이 변경됐습니다');
    return { status: 'resolved', runner, version, queries, projects, affected: [...new Set(affected)] };
  } catch (error) {
    // Do not include raw runner output (dry-run output may contain environment details).
    return { status: 'fallback', runner, version, queries, reason: error.message, ...(error.incompleteInventory ? { incompleteInventory: true } : {}) };
  }
}
