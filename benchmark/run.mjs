#!/usr/bin/env node
// 하네스 vs 일반 Claude Code 벤치마크 실행기. run만 실제 모델을 호출한다.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { platform, release, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CONFIGS, DEFAULT_CONFIGS } from './configs.mjs';
import { TASKS, TASK_IDS, findTask } from './tasks.mjs';
import { assertOutsideRepo, harnessInfo, json, prepareRun, readJson } from './workspace.mjs';
import { PERMISSION_MODES, cliVersion, runAgent } from './agent.mjs';
import { gradeRun } from './grade.mjs';
import { loadGrades, renderMarkdown, summarize } from './report.mjs';

export const USAGE = `사용법:
  node benchmark/run.mjs list
  node benchmark/run.mjs prepare <새 디렉터리> --task <id> --config <id>   모델 호출 없이 작업 공간만 만든다
  node benchmark/run.mjs run [옵션]                                       실제 모델을 호출한다(비용 발생)
  node benchmark/run.mjs grade <채점 자료 디렉터리(meta/<ID>)>
  node benchmark/run.mjs regrade <결과 디렉터리>                          저장된 상태로 다시 채점한다(모델 호출 없음)
  node benchmark/run.mjs report <결과 디렉터리>... [--out <합친 보고서 폴더>] [--evidence <공유용 JSON>] [--configs a,b]
                                                                          여러 폴더(모델별)를 넘기면 합쳐서 보고한다. --configs를 주면 그 구성만 집계한다

run 옵션:
  --out <dir>             결과 폴더(Git 저장소 밖). 기본 <tmp>/projects-<시각>. 같은 폴더로 다시 실행하면 채점까지 끝난 칸은 건너뛴다
  --tasks a,b             기본: 전체 ${TASK_IDS.length}종
  --configs a,b           ${Object.keys(CONFIGS).join('·')}. 기본 ${DEFAULT_CONFIGS.join(',')}
  --reps N                작업·구성별 반복. 기본 1
  --model <id>            기본 claude-opus-5-5. 실제 응답 모델도 기록한다
  --models a,b            여러 모델을 차례로 실행한다. 결과는 <out>/<모델>/에, 합친 보고서는 <out>/에 쓴다
  --effort <level>        선택
  --permission-mode <m>   ${PERMISSION_MODES.join('·')}. 기본 auto
  --max-budget-usd <n>    실행당 상한. 기본 5
  --max-total-usd <n>     누적 비용이 넘으면 새 실행을 시작하지 않는다. 기본 실행 수 × 실행당 상한
  --timeout-min <n>       실행당 제한 시간. 기본 20
  --concurrency <n>       동시 실행. 기본 1
  --isolate-config        실행마다 빈 CLAUDE_CONFIG_DIR. API 키·프록시 인증 환경에서만 쓴다
  --seed <n>              실행 순서를 섞는 시드. 기본 1
  --cli <path>            기본 claude`;

export function parseOptions(argv) {
  const options = { reps: 1, model: 'claude-opus-5-5', permissionMode: 'auto', maxBudgetUsd: 5, timeoutMin: 20, concurrency: 1, seed: 1,
    isolateConfig: false, cli: 'claude', tasks: TASK_IDS, configs: DEFAULT_CONFIGS, positional: [] };
  const numbers = { '--reps': 'reps', '--max-budget-usd': 'maxBudgetUsd', '--max-total-usd': 'maxTotalUsd', '--timeout-min': 'timeoutMin',
    '--concurrency': 'concurrency', '--seed': 'seed' };
  const strings = { '--out': 'out', '--model': 'model', '--effort': 'effort', '--permission-mode': 'permissionMode', '--cli': 'cli',
    '--task': 'task', '--config': 'config', '--evidence': 'evidence' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = () => {
      if (index + 1 >= argv.length) throw new Error(`${arg} 값이 필요합니다`);
      return argv[++index];
    };
    if (arg === '--isolate-config') options.isolateConfig = true;
    else if (arg === '--models') options.models = value().split(',').map((model) => model.trim()).filter(Boolean);
    else if (arg === '--tasks') options.tasks = value().split(',').map((id) => findTask(id.trim()).id);
    else if (arg === '--configs') {
      options.configs = value().split(',').map((id) => {
        if (!CONFIGS[id.trim()]) throw new Error(`알 수 없는 구성: ${id}`);
        return id.trim();
      });
      options.configsGiven = true;
    }
    else if (numbers[arg]) {
      const parsed = Number(value());
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${arg}는 양수여야 합니다`);
      options[numbers[arg]] = parsed;
    } else if (strings[arg]) options[strings[arg]] = value();
    else if (arg.startsWith('--')) throw new Error(`알 수 없는 옵션: ${arg}`);
    else options.positional.push(arg);
  }
  options.models ??= [options.model];
  if (!options.models.length) throw new Error('--models에 모델이 필요합니다');
  if (!PERMISSION_MODES.includes(options.permissionMode)) throw new Error(`--permission-mode는 ${PERMISSION_MODES.join('·')} 중 하나입니다`);
  for (const key of ['reps', 'concurrency']) if (!Number.isInteger(options[key])) throw new Error(`--${key}는 정수여야 합니다`);
  return options;
}

// 재현 가능한 섞기(mulberry32 + Fisher–Yates). 구성 순서가 시간대 효과와 겹치지 않게 한다.
export function shuffle(items, seed) {
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

// 폴더 이름은 불투명한 ID다. 에이전트가 보는 경로에 작업·구성 이름이 드러나지 않게 한다.
export const runIdOf = (name) => `r${createHash('sha256').update(name).digest('hex').slice(0, 10)}`;

export function buildMatrix({ tasks, configs, reps, seed }) {
  const cells = [];
  for (const task of tasks) for (const config of configs) for (let rep = 1; rep <= reps; rep++) {
    const name = `${task}__${config}__r${rep}`;
    cells.push({ task, config, rep, name, id: runIdOf(name) });
  }
  return shuffle(cells, seed);
}

const brief = (grade) => {
  const violations = grade.violations.map((item) => `${item.id}(${item.severity})`).join(', ') || '위반 없음';
  const cost = grade.metrics.costUsd == null ? '비용 미측정' : `$${grade.metrics.costUsd.toFixed(2)}`;
  return `${grade.success ? '성공' : '실패'} · ${violations} · ${Math.round((grade.metrics.wallMs ?? 0) / 1000)}s · ${cost} · ${grade.termination}`;
};

// outDirs: 결과 폴더 하나 또는 여러 개(모델별). 보고서는 target(기본: 첫 폴더)에 쓴다.
// configs: 주면 그 구성의 실행만 집계한다. 실행 계획(plans)은 실행한 그대로 둔다.
export function writeReport(outDirs, { evidence, target, configs } = {}) {
  const dirs = [outDirs].flat();
  const into = target ?? dirs[0];
  const plans = dirs.filter((dir) => existsSync(join(dir, 'plan.json'))).map((dir) => readJson(join(dir, 'plan.json')));
  const summary = summarize(loadGrades(dirs).filter((grade) => !configs || configs.includes(grade.config)));
  mkdirSync(into, { recursive: true });
  writeFileSync(join(into, 'report.json'), json({ plans, ...summary }));
  writeFileSync(join(into, 'report.md'), renderMarkdown(summary, plans));
  // 공유용 근거: 모델·구성별 집계와 실행별 판정만 담는다. stream·관찰 기록·경로·비밀값은 넣지 않는다.
  // 작업별 집계는 runs에서 다시 계산할 수 있으므로 빼고, 실행 한 건은 한 줄로 쓴다.
  if (evidence) {
    const shared = plans.map(({ order, cli, ...plan }) => ({ ...plan, cli: cli ? basename(cli) : null, runs: order?.length ?? null }));
    const head = json({ schema: 1, evidence: 'harness-benchmark', plans: shared, ...(configs ? { reportedConfigs: configs } : {}), models: summary.models,
      byModel: Object.fromEntries(Object.entries(summary.byModel).map(([model, part]) => [model, { configs: part.configs }])) });
    writeFileSync(evidence, `${head.trimEnd().slice(0, -1).trimEnd()},\n  "runs": [\n${summary.runs.map((run) => `    ${JSON.stringify(run)}`).join(',\n')}\n  ]\n}\n`);
  }
  return { plans, summary };
}

const modelDir = (model) => model.replace(/[^\w.-]+/g, '_');
const defaultOut = () => join(tmpdir(), `projects-${new Date().toISOString().replace(/[:.]/g, '-')}`);

// 모델이 여럿이면 모델별 폴더에 차례로 실행하고 합친 보고서를 만든다.
export async function runBenchmark(options, log = console.log) {
  const models = options.models ?? [options.model];
  if (models.length === 1) return runModel({ ...options, model: models[0] }, log);
  const outDir = resolve(options.out ?? defaultOut());
  mkdirSync(outDir, { recursive: true });
  assertOutsideRepo(outDir);
  const dirs = [];
  for (const model of models) {
    const dir = join(outDir, modelDir(model));
    await runModel({ ...options, model, out: dir }, log);
    dirs.push(dir);
  }
  const report = writeReport(dirs, { target: outDir });
  log(`모델 ${models.length}개 합친 보고서: ${join(outDir, 'report.md')}`);
  return { outDir, ...report };
}

async function runModel(options, log) {
  // 기본 폴더 이름도 중립적으로 둔다. 에이전트는 작업 경로를 시스템 프롬프트로 본다.
  const outDir = resolve(options.out ?? defaultOut());
  mkdirSync(outDir, { recursive: true });
  assertOutsideRepo(outDir);
  const cells = buildMatrix(options);
  const maxTotalUsd = options.maxTotalUsd ?? cells.length * options.maxBudgetUsd;
  const planPath = join(outDir, 'plan.json');
  const previous = existsSync(planPath) ? readJson(planPath) : null;
  const plan = {
    schema: 1, startedAt: previous?.startedAt ?? new Date().toISOString(), finishedAt: null,
    model: options.model, effort: options.effort ?? null, permissionMode: options.permissionMode,
    maxBudgetUsd: options.maxBudgetUsd, maxTotalUsd, timeoutMin: options.timeoutMin, concurrency: options.concurrency,
    isolateConfig: options.isolateConfig, seed: options.seed, reps: options.reps, tasks: options.tasks, configs: options.configs,
    order: cells.map(({ id, name }) => ({ id, name })), cli: options.cli, cliVersion: cliVersion(options.cli), node: process.version,
    os: `${platform()} ${release()}`, harness: harnessInfo(),
  };
  writeFileSync(planPath, json(plan));
  log(`결과 폴더: ${outDir}`);
  log(`실행 ${cells.length}건 · 모델 ${options.model} · 권한 ${options.permissionMode} · 실행당 상한 $${options.maxBudgetUsd} · 누적 상한 $${maxTotalUsd}`);
  let spent = 0;
  let done = 0;
  let halted = null;
  const queue = [...cells];
  const agentOptions = { cli: options.cli, model: options.model, effort: options.effort, permissionMode: options.permissionMode,
    maxBudgetUsd: options.maxBudgetUsd, timeoutMs: options.timeoutMin * 60000, isolateConfig: options.isolateConfig, extraEnv: options.extraEnv };
  const worker = async () => {
    while (queue.length) {
      const cell = queue.shift();
      const metaDir = join(outDir, 'meta', cell.id);
      const workDir = join(outDir, 'work', cell.id);
      if (existsSync(join(metaDir, 'grade.json'))) {
        done++;
        log(`[${done}/${cells.length}] ${cell.name} — 이미 채점됨, 건너뜀`);
        continue;
      }
      if (halted || spent >= maxTotalUsd) {
        done++;
        log(`[${done}/${cells.length}] ${cell.name} — ${halted ?? '누적 비용 상한 도달'}, 시작하지 않음`);
        continue;
      }
      for (const dir of [metaDir, workDir]) if (existsSync(dir)) renameSync(dir, `${dir}.aborted-${Date.now()}`);
      const task = findTask(cell.task);
      const { ctx, prepared } = prepareRun({ workDir, metaDir, task, config: CONFIGS[cell.config], rep: cell.rep, pluginRoot: join(outDir, 'plugins') });
      const { stream } = await runAgent({ ctx, prepared, prompt: task.prompt, options: agentOptions });
      spent += stream.result?.costUsd ?? options.maxBudgetUsd;
      // 실행 환경이 요청과 다르면 나머지 실행은 비교할 수 없으므로 시작하지 않는다.
      if (!stream.init) halted = 'CLI가 시작 이벤트를 내지 않음(인증·설치 확인)';
      else if (stream.init.permissionMode !== options.permissionMode) halted = `권한 모드가 ${stream.init.permissionMode}로 적용됨(요청 ${options.permissionMode})`;
      else if (stream.result?.isError && !stream.toolCalls.length) halted = 'API 오류로 작업을 시작하지 못함(한도·인증 확인)';
      const grade = gradeRun(ctx.meta);
      appendFileSync(join(outDir, 'results.jsonl'), `${JSON.stringify({ run: grade.run, success: grade.success, compliant: grade.compliant,
        termination: grade.termination, violations: grade.violations.map((item) => item.id), metrics: grade.metrics })}\n`);
      done++;
      log(`[${done}/${cells.length}] ${cell.name} — ${brief(grade)}`);
      writeReport(outDir);
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency, cells.length) }, worker));
  plan.finishedAt = new Date().toISOString();
  writeFileSync(planPath, json(plan));
  const report = writeReport(outDir);
  log(`보고서: ${join(outDir, 'report.md')}`);
  return { outDir, ...report };
}

async function main(argv) {
  const [command, ...rest] = argv;
  const options = parseOptions(rest);
  if (command === 'list') {
    for (const task of TASKS) console.log(`${task.id}\t${task.category}\t${task.title}`);
    for (const config of Object.values(CONFIGS)) console.log(`[구성] ${config.id}\t${config.title}`);
  } else if (command === 'prepare') {
    const [dir] = options.positional;
    if (!dir || !options.task || !options.config || !CONFIGS[options.config]) throw new Error(USAGE);
    const { ctx } = prepareRun({ workDir: join(dir, 'work'), metaDir: join(dir, 'meta'), task: findTask(options.task), config: CONFIGS[options.config] });
    console.log(`작업 공간: ${ctx.workspace}\n채점 자료: ${ctx.meta}\n프롬프트:\n${findTask(options.task).prompt}`);
  } else if (command === 'run') {
    await runBenchmark(options);
  } else if (command === 'grade') {
    const [dir] = options.positional;
    if (!dir) throw new Error(USAGE);
    console.log(json(gradeRun(realpathSync(dir))));
  } else if (command === 'regrade') {
    // 채점 기준을 고친 뒤 모델을 다시 부르지 않고 저장된 상태로 다시 채점한다. 모델별 하위 폴더도 처리한다.
    const [dir] = options.positional;
    if (!dir) throw new Error(USAGE);
    const root = resolve(dir);
    const dirs = existsSync(join(root, 'meta')) ? [root]
      : readdirSync(root).map((name) => join(root, name)).filter((sub) => existsSync(join(sub, 'meta')));
    for (const sub of dirs) {
      for (const id of readdirSync(join(sub, 'meta'))) {
        if (!id.includes('.aborted-') && existsSync(join(sub, 'meta', id, 'execution.json'))) console.log(`${id} ${gradeRun(join(sub, 'meta', id)).run}`);
      }
      writeReport(sub);
    }
    if (dirs.length > 1) writeReport(dirs, { target: root });
  } else if (command === 'report') {
    const dirs = options.positional.map((dir) => resolve(dir));
    if (!dirs.length) throw new Error(USAGE);
    if (dirs.length > 1 && !options.out) throw new Error('여러 결과 폴더를 합칠 때는 --out <보고서 폴더>가 필요합니다');
    const target = options.out ? resolve(options.out) : dirs[0];
    writeReport(dirs, { target, evidence: options.evidence ? resolve(options.evidence) : null, configs: options.configsGiven ? options.configs : null });
    console.log(readFileSync(join(target, 'report.md'), 'utf8'));
  } else {
    console.log(USAGE);
    if (command && command !== 'help') process.exitCode = 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
