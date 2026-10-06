#!/usr/bin/env node
// 시험용 가짜 Claude CLI. 모델을 호출하지 않고 FAKE_CLAUDE_STEPS(JSON)의 도구 호출을 순서대로 실행한다.
// 실제 CLI처럼 --settings와 프로젝트 .claude/settings.json의 PreToolUse/PostToolUse 훅을 실행하고,
// 훅 종료 코드 2와 Read deny를 차단으로 처리한 뒤 stream-json을 출력한다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, isAbsolute, join } from 'node:path';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('0.0.0-fake (Claude Code)');
  process.exit(0);
}
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const cwd = process.cwd();
const model = option('--model') ?? 'fake-model';
const steps = JSON.parse(readFileSync(process.env.FAKE_CLAUDE_STEPS, 'utf8'));
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const readSettings = (path) => (path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {});
const sources = [readSettings(option('--settings')), readSettings(join(cwd, '.claude', 'settings.json'))];
const deny = sources.flatMap((settings) => settings.permissions?.deny ?? []);

const hooksFor = (event, tool) => sources.flatMap((settings) => (settings.hooks?.[event] ?? [])
  .filter((group) => !group.matcher || group.matcher === '*' || new RegExp(`^(?:${group.matcher})$`).test(tool))
  .flatMap((group) => group.hooks));

const runHooks = (event, tool, input, id) => hooksFor(event, tool).map((hook) => {
  const payload = JSON.stringify({ session_id: 'fake', hook_event_name: event, tool_name: tool, tool_input: input, tool_use_id: id, cwd, permission_mode: option('--permission-mode') });
  const result = spawnSync('bash', ['-c', hook.command], { cwd, input: payload, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: cwd } });
  return { command: hook.command, status: result.status, stderr: result.stderr };
});

const denied = (path) => deny.some((rule) => {
  const match = /^Read\(\.\/(.+)\)$/.exec(rule);
  if (!match) return false;
  const pattern = new RegExp(`^${match[1].replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\*/g, '[^/]*')}$`);
  return pattern.test(basename(path));
});

function execute(step) {
  const path = step.path ? (isAbsolute(step.path) ? step.path : join(cwd, step.path)) : null;
  if (step.tool === 'Bash') {
    const result = spawnSync('bash', ['-c', step.command], { cwd, encoding: 'utf8', env: process.env });
    return { isError: result.status !== 0, content: `${result.stdout}${result.stderr}`.trim() || '(no output)' };
  }
  if (step.tool === 'Read') {
    if (denied(path)) return { isError: true, content: '<tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>' };
    return existsSync(path) ? { isError: false, content: readFileSync(path, 'utf8') } : { isError: true, content: 'File does not exist.' };
  }
  if (step.tool === 'Edit') {
    const before = readFileSync(path, 'utf8');
    if (!before.includes(step.old)) return { isError: true, content: 'String to replace not found in file.' };
    writeFileSync(path, before.replace(step.old, step.new));
    return { isError: false, content: `The file ${path} has been updated successfully.` };
  }
  if (step.tool === 'Write') {
    writeFileSync(path, step.content);
    return { isError: false, content: `File created successfully at: ${path}` };
  }
  throw new Error(`알 수 없는 도구: ${step.tool}`);
}

emit({ type: 'system', subtype: 'init', model, permissionMode: process.env.FAKE_CLAUDE_PERMISSION_MODE ?? option('--permission-mode'), claude_code_version: '0.0.0-fake',
  tools: ['Bash', 'Read', 'Edit', 'Write'], skills: [], plugins: option('--plugin-dir') ? [{ name: 'guksu-harness' }] : [] });
const denials = [];
let index = 0;
for (const step of steps) {
  index++;
  if (step.text) {
    emit({ type: 'assistant', message: { id: `msg_${index}`, model, content: [{ type: 'text', text: step.text }], usage: { input_tokens: 10, output_tokens: 5 } } });
    continue;
  }
  const id = `toolu_${index}`;
  const input = step.tool === 'Bash' ? { command: step.command } : step.tool === 'Edit' ? { file_path: step.path, old_string: step.old, new_string: step.new }
    : step.tool === 'Write' ? { file_path: step.path, content: step.content } : { file_path: step.path };
  emit({ type: 'assistant', message: { id: `msg_${index}`, model, content: [{ type: 'tool_use', id, name: step.tool, input }], usage: { input_tokens: 10, output_tokens: 5 } } });
  const blocked = runHooks('PreToolUse', step.tool, input, id).find((hook) => hook.status === 2);
  let result;
  if (blocked) {
    result = { isError: true, content: `PreToolUse:${step.tool} hook error: [${blocked.command}]: ${blocked.stderr}` };
    denials.push({ tool_name: step.tool, tool_use_id: id });
  } else {
    result = execute(step);
    if (!result.content.includes('denied by your permission settings')) runHooks('PostToolUse', step.tool, input, id);
    else denials.push({ tool_name: step.tool, tool_use_id: id });
  }
  emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: result.isError, content: result.content }] } });
}
const finalText = steps.findLast?.((step) => step.text)?.text ?? '';
emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1000, duration_api_ms: 800, num_turns: steps.length,
  total_cost_usd: 0.01 * steps.length, usage: { input_tokens: 10 * steps.length, output_tokens: 5 * steps.length, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  modelUsage: { [model]: { costUSD: 0.01 * steps.length } }, permission_denials: denials, terminal_reason: 'completed', result: finalText });
