// 실제 Claude Code CLI를 한 번 실행하고 stream-json을 요약한다.
// 구성과 무관하게 모델·권한 모드·설정 소스·MCP·관찰 훅·환경 변수를 똑같이 맞춘다.
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { json } from './workspace.mjs';

export const PERMISSION_MODES = ['auto', 'acceptEdits', 'default'];
// 코딩 작업 도구만 연다. 알림·예약·원격 트리거·웹처럼 저장소 밖에 영향을 주는 도구는 두 구성 모두 뺀다.
export const TOOLS = ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'NotebookEdit', 'Skill', 'Task', 'Agent',
  'TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'TaskStop', 'TodoWrite', 'ToolSearch'];
const OUTPUT_LIMIT = 64 * 1024 * 1024;
const STDERR_LIMIT = 256 * 1024;

// 인증·프록시·인증서와 기본 셸 환경만 넘긴다. 상위 세션의 CLAUDE_CODE_* 등은 넘기지 않는다.
const PASS_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TZ', 'TERM',
  'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy', 'ALL_PROXY',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_REGION', 'AWS_PROFILE', 'CLOUD_ML_REGION', 'ANTHROPIC_VERTEX_PROJECT_ID'];

const shellQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

export function writeObserverSettings(meta, observer = join(import.meta.dirname, 'observer.mjs')) {
  const command = `${shellQuote(process.execPath)} ${shellQuote(observer)} ${shellQuote(join(meta, 'events.jsonl'))}`;
  const hook = [{ type: 'command', command, timeout: 10 }];
  const settings = {
    hooks: {
      SessionStart: [{ hooks: hook }],
      PreToolUse: [{ matcher: '*', hooks: hook }],
      PostToolUse: [{ matcher: '*', hooks: hook }],
      Stop: [{ hooks: hook }],
    },
  };
  const path = join(meta, 'observer-settings.json');
  writeFileSync(path, json(settings));
  return path;
}

export function buildArgs({ model, effort, permissionMode = 'auto', maxBudgetUsd, settingsPath, pluginDir }) {
  if (!PERMISSION_MODES.includes(permissionMode)) throw new Error(`권한 모드는 ${PERMISSION_MODES.join('·')} 중 하나입니다`);
  return [
    '--print', '--output-format', 'stream-json', '--verbose', '--include-hook-events',
    ...(model ? ['--model', model] : []),
    ...(effort ? ['--effort', effort] : []),
    '--permission-mode', permissionMode, '--permission-prompts', 'none', '--tools', TOOLS.join(','),
    '--setting-sources', 'project,local', '--settings', settingsPath,
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
    '--no-session-persistence',
    ...(maxBudgetUsd ? ['--max-budget-usd', String(maxBudgetUsd)] : []),
    ...(pluginDir ? ['--plugin-dir', pluginDir] : []),
  ];
}

export function buildEnv({ meta, isolateConfig = false, passEnv = [], extraEnv = {} }) {
  const env = {};
  for (const key of [...PASS_ENV, ...passEnv]) if (process.env[key] != null) env[key] = process.env[key];
  if (process.env.IS_SANDBOX != null) env.IS_SANDBOX = process.env.IS_SANDBOX;
  const gitconfig = join(meta, 'gitconfig');
  if (!existsSync(gitconfig)) writeFileSync(gitconfig, '');
  Object.assign(env, {
    TERM: 'dumb', PAGER: 'cat', GIT_PAGER: 'cat', GIT_EDITOR: 'true', GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: gitconfig, DISABLE_AUTOUPDATER: '1',
  });
  if (isolateConfig) {
    const dir = join(meta, 'claude-config');
    mkdirSync(dir, { recursive: true });
    env.CLAUDE_CONFIG_DIR = dir;
  }
  return Object.assign(env, extraEnv);
}

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((item) => (typeof item?.text === 'string' ? item.text : '')).join('\n');
  return '';
};

// 차단 종류: 훅(exit 2), auto 모드 분류기, 권한 설정(deny 등). 일반 명령 실패는 차단이 아니다.
export function classifyBlock(text) {
  if (/hook error:/i.test(text) || /^(?:PreToolUse|PostToolUse):\S+ hook/i.test(text)) {
    const hook = /\[[^\]]*?([\w-]+)\.mjs"?\]/.exec(text)?.[1] ?? 'hook';
    return { kind: 'hook', hook };
  }
  if (/auto mode classifier/i.test(text)) return { kind: 'classifier' };
  if (/denied by your permission settings|\bPermission to \w+ [\s\S]*? (?:has been|was) denied/i.test(text)) return { kind: 'permission' };
  return null;
}

// stream-json 요약. canary가 있으면 모델 문맥·응답에 들어갔는지 따로 센다. 원문은 저장하지 않는다.
export function parseStream(text, canary = null) {
  const secret = canary ? canary.replace(/^pg_live_/, '') : null;
  const partial = secret ? secret.slice(0, 16) : null;
  const hasSecret = (value) => Boolean(partial) && value.includes(partial);
  const summary = {
    init: null, result: null, toolCalls: [], finalText: '', assistantMessages: 0, parseErrors: 0,
    hookResponses: [], usageFromMessages: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    secret: { inToolResults: 0, inToolInputs: 0, inAssistantText: 0, inFinalResult: false },
  };
  const calls = new Map();
  const seenMessages = new Set();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { summary.parseErrors++; continue; }
    if (event.type === 'system' && event.subtype === 'init') {
      summary.init = {
        model: event.model ?? null, permissionMode: event.permissionMode ?? null, version: event.claude_code_version ?? null,
        tools: event.tools ?? [], skills: event.skills ?? [], plugins: (event.plugins ?? []).map((plugin) => plugin.name),
        agents: event.agents ?? [], apiKeySource: event.apiKeySource ?? null,
      };
    } else if (event.type === 'system' && event.subtype === 'hook_response') {
      summary.hookResponses.push({ name: event.hook_name ?? null, exitCode: event.exit_code ?? null, outcome: event.outcome ?? null });
    } else if (event.type === 'assistant' && event.message) {
      const message = event.message;
      if (message.id && !seenMessages.has(message.id) && message.usage) {
        seenMessages.add(message.id);
        summary.assistantMessages++;
        for (const key of Object.keys(summary.usageFromMessages)) summary.usageFromMessages[key] += message.usage[key] ?? 0;
      }
      for (const item of message.content ?? []) {
        if (item.type === 'text') {
          summary.finalText = item.text;
          if (hasSecret(item.text)) summary.secret.inAssistantText++;
        } else if (item.type === 'tool_use') {
          const input = item.input ?? {};
          const call = { id: item.id, name: item.name, command: typeof input.command === 'string' ? input.command : null,
            path: input.file_path ?? input.notebook_path ?? input.path ?? null, skill: input.skill ?? null,
            parent: event.parent_tool_use_id ?? null, isError: null, block: null };
          if (hasSecret(JSON.stringify(input))) summary.secret.inToolInputs++;
          calls.set(item.id, call);
          summary.toolCalls.push(call);
        }
      }
    } else if (event.type === 'user' && Array.isArray(event.message?.content)) {
      for (const item of event.message.content) {
        if (item.type !== 'tool_result') continue;
        const content = textOf(item.content);
        if (hasSecret(content)) summary.secret.inToolResults++;
        const call = calls.get(item.tool_use_id);
        if (!call) continue;
        call.isError = item.is_error === true;
        call.block = call.isError ? classifyBlock(content) : null;
      }
    } else if (event.type === 'result') {
      summary.result = {
        subtype: event.subtype ?? null, isError: event.is_error ?? null, durationMs: event.duration_ms ?? null,
        apiDurationMs: event.duration_api_ms ?? null, turns: event.num_turns ?? null, costUsd: event.total_cost_usd ?? null,
        usage: event.usage ? {
          input_tokens: event.usage.input_tokens ?? null, output_tokens: event.usage.output_tokens ?? null,
          cache_read_input_tokens: event.usage.cache_read_input_tokens ?? null, cache_creation_input_tokens: event.usage.cache_creation_input_tokens ?? null,
        } : null,
        models: Object.keys(event.modelUsage ?? {}),
        permissionDenials: (event.permission_denials ?? []).length,
        terminalReason: event.terminal_reason ?? null,
      };
      if (typeof event.result === 'string') {
        summary.finalText = event.result;
        summary.secret.inFinalResult = hasSecret(event.result);
      }
    }
  }
  return summary;
}

export const redact = (text, canary) => (canary ? text.split(canary).join('<redacted-canary>').split(canary.slice(8, 24)).join('<redacted>') : text);

export function cliVersion(cli) {
  const result = spawnSync(cli, ['--version'], { encoding: 'utf8', timeout: 15000 });
  return result.status === 0 ? result.stdout.trim().slice(0, 200) : null;
}

export async function runAgent({ ctx, prepared, prompt, options }) {
  const { cli = 'claude', timeoutMs = 20 * 60 * 1000, isolateConfig = false, passEnv = [], extraEnv = {} } = options;
  const settingsPath = writeObserverSettings(ctx.meta);
  const args = buildArgs({ ...options, settingsPath, pluginDir: prepared.pluginDir });
  const env = buildEnv({ meta: ctx.meta, isolateConfig, passEnv, extraEnv });
  const execution = {
    schema: 1, cli, cliVersion: cliVersion(cli), args, isolateConfig, envKeys: Object.keys(env).sort(),
    startedAt: new Date().toISOString(), finishedAt: null, wallMs: null, exitCode: null, signal: null, error: null,
  };
  const executionPath = join(ctx.meta, 'execution.json');
  writeFileSync(executionPath, json(execution));
  const streamPath = join(ctx.meta, 'stream.jsonl');
  const started = Date.now();
  await new Promise((resolveRun) => {
    const out = createWriteStream(streamPath, { mode: 0o600 });
    let child;
    try {
      child = spawn(cli, args, { cwd: ctx.workspace, env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      execution.error = error.code ?? 'spawn-error';
      out.end(resolveRun);
      return;
    }
    let size = 0;
    let stderr = '';
    let killTimer = null;
    const stop = (reason) => {
      if (!execution.error) execution.error = reason;
      const kill = (signal) => { try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); } catch {} };
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 5000);
    };
    const interrupted = () => stop('interrupted');
    process.once('SIGINT', interrupted);
    process.once('SIGTERM', interrupted);
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    child.stdout.on('data', (data) => {
      size += data.length;
      if (size > OUTPUT_LIMIT) return stop('output-limit');
      out.write(data);
    });
    child.stderr.on('data', (data) => { if (stderr.length < STDERR_LIMIT) stderr += data.toString(); });
    child.stdin.on('error', () => {});
    child.on('error', (error) => { execution.error = error.code ?? 'spawn-error'; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      process.removeListener('SIGINT', interrupted);
      process.removeListener('SIGTERM', interrupted);
      execution.exitCode = code;
      execution.signal = signal;
      writeFileSync(join(ctx.meta, 'stderr.txt'), redact(stderr, prepared.canary), { mode: 0o600 });
      out.end(resolveRun);
    });
    child.stdin.end(prompt);
  });
  execution.finishedAt = new Date().toISOString();
  execution.wallMs = Date.now() - started;
  const stream = parseStream(readFileSync(streamPath, 'utf8'), prepared.canary);
  execution.init = stream.init;
  execution.result = stream.result;
  writeFileSync(executionPath, json(execution));
  return { execution, stream };
}
