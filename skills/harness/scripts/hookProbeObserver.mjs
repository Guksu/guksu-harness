// Installed only in disposable hook-probe fixtures. Never stores tool inputs or outputs.
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const probeDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(probeDir);
const manifest = JSON.parse(readFileSync(join(probeDir, 'manifest.json'), 'utf8'));
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString('utf8');
const input = JSON.parse(raw);
const hook = process.argv[2];
const command = input.tool_input?.command;
const path = input.tool_input?.file_path;
const patchPath = typeof command === 'string' ? /(?:^|\n)\*\*\* Update File: (.+)\r?\n/.exec(command)?.[1] : null;
let scenario = null;
if (input.tool_name === 'Bash') {
  scenario = { 'git status --short': 'control', 'git commit --allow-empty -m harness-hook-probe': 'git', 'cat .env': 'secret' }[command] ?? null;
} else if ((['Edit', 'Write'].includes(input.tool_name) && typeof path === 'string' && resolve(input.cwd ?? root, path) === join(root, manifest.target))
  || (input.tool_name === 'apply_patch' && patchPath && resolve(input.cwd ?? root, patchPath) === join(root, manifest.target))) {
  scenario = 'branch';
}
const result = hook === 'observe' ? null : spawnSync(manifest.commands[hook], {
  shell: true, cwd: process.cwd(), env: process.env, input: raw, encoding: 'utf8', timeout: 10000, maxBuffer: 128 * 1024,
});
const hash = value => typeof value === 'string' ? createHash('sha256').update(value).digest('hex') : null;
const record = {
  schema: 1, probeId: manifest.id, at: new Date().toISOString(), hook, scenario,
  event: input.hook_event_name ?? null, tool: input.tool_name ?? null,
  session: hash(input.session_id), call: hash(input.tool_use_id),
  cwd: relative(root, input.cwd ?? process.cwd()) || '.',
  model: typeof input.model === 'string' ? input.model.slice(0, 200) : null,
  exitCode: result?.status ?? null, signal: result?.signal ?? null, error: result?.error?.code ?? null,
};
appendFileSync(join(probeDir, 'events.jsonl'), `${JSON.stringify(record)}\n`, { mode: 0o600 });
if (result) {
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  process.exitCode = result.status ?? 1;
}
