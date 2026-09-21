import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './guksu-harness.mjs';

const cli = fileURLToPath(new URL('./guksu-harness.mjs', import.meta.url));
const fixture = t => { const root = mkdtempSync(join(tmpdir(), 'guksu-cli-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
const write = (root, path, content) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content); };

test('인자 파싱 — 명령·프로젝트·옵션을 구분하고 모르는 옵션은 거부한다', () => {
  assert.deepEqual(parseArgs(['init', '/p', '--app', 'both', '--verifier']), { command: 'init', positional: ['/p'], options: { '--app': 'both', '--verifier': true } });
  assert.deepEqual(parseArgs(['eject', '.agents/hooks/branchGuard.mjs', '--confirm']).positional, ['.agents/hooks/branchGuard.mjs']);
  assert.equal(parseArgs([]).command, 'help');
  assert.throws(() => parseArgs(['init', '--app']), /값이 필요/);
  assert.throws(() => parseArgs(['status', '--verifier']), /알 수 없는 옵션/);
  assert.throws(() => parseArgs(['deploy']), /알 수 없는 명령/);
});

test('help는 사용법을 출력하고 0으로 끝난다', () => {
  const result = run('--help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /init/);
  assert.match(result.stdout, /eject/);
});

test('init → check → update → eject 흐름', t => {
  const root = fixture(t);
  write(root, 'AGENTS.md', '# 우리 프로젝트\n');
  const dry = run('init', root, '--dry-run', '--app', 'both');
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(existsSync(join(root, '.agents')), false, 'dry-run은 파일을 만들지 않는다');

  const init = run('init', root, '--app', 'both');
  assert.equal(init.status, 0, init.stderr + init.stdout);
  assert.match(init.stdout, /다음 할 일/);
  assert.match(init.stdout, /검사 완료 — error 0건/);
  for (const path of ['.agents/hooks/branchGuard.mjs', '.agents/harness-core-rules.md', 'docs/harness-rules.md', 'CLAUDE.md', '.claude/settings.json', '.codex/hooks.json']) {
    assert.ok(existsSync(join(root, path)), path);
  }
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), '# 우리 프로젝트\n', '기존 규칙 파일은 보존한다');

  const again = run('init', root);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /이미 설치된/);

  const check = run('check', root);
  assert.equal(check.status, 0, check.stdout);
  assert.match(check.stdout, /error 0건/);

  const update = run('update', root);
  assert.equal(update.status, 0, update.stderr);
  assert.match(update.stdout, /변경 없음/);

  write(root, '.agents/hooks/branchGuard.mjs', '// 우리가 고침\n');
  const conflicted = run('update', root);
  assert.equal(conflicted.status, 1);
  assert.match(conflicted.stdout, /충돌 1건/);

  const noConfirm = run('eject', root, '.agents/hooks/branchGuard.mjs');
  assert.equal(noConfirm.status, 1);
  assert.match(noConfirm.stderr, /--confirm/);
  const ejected = run('eject', root, '.agents/hooks/branchGuard.mjs', '--confirm');
  assert.equal(ejected.status, 0, ejected.stderr);
  const after = run('update', root);
  assert.equal(after.status, 0, after.stdout);
  assert.equal(readFileSync(join(root, '.agents/hooks/branchGuard.mjs'), 'utf8'), '// 우리가 고침\n');

  const status = run('status', root, '--json');
  assert.equal(status.status, 0);
  assert.deepEqual(JSON.parse(status.stdout).ejected, ['.agents/hooks/branchGuard.mjs']);
});

test('update는 설치 기록이 없으면 init을 안내하고, check는 error가 있으면 1로 끝난다', t => {
  const root = fixture(t);
  const update = run('update', root);
  assert.equal(update.status, 1);
  assert.match(update.stderr, /init/);
  run('init', root);
  write(root, '.agents/hooks/branchGuard.config.json', '{"protectedBranches":"main"}');
  const check = run('check', root);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /\[error\]/);
  assert.doesNotMatch(check.stdout, /"main"/, '설정값을 출력하지 않는다');
});

test('프로젝트 디렉터리가 없으면 실패한다', () => {
  const result = run('status', '/nonexistent/path/for/guksu');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /디렉터리가 없습니다/);
});

test('init --ci는 워크플로를 만들고, update는 팀이 고친 템플릿을 보존한다', t => {
  const root = fixture(t);
  const init = run('init', root, '--ci', '--app', 'claude');
  assert.equal(init.status, 0, init.stderr + init.stdout);
  assert.ok(existsSync(join(root, '.github/workflows/harness-check.yml')));
  assert.ok(existsSync(join(root, '.agents/harness-base/docs/templates/history.md')));
  write(root, 'docs/templates/history.md', `${readFileSync(join(root, 'docs/templates/history.md'), 'utf8')}\n팀 추가\n`);
  const update = run('update', root);
  assert.equal(update.status, 0, update.stdout);
  assert.ok(readFileSync(join(root, 'docs/templates/history.md'), 'utf8').endsWith('팀 추가\n'), '팀 수정을 덮어쓰지 않는다');
  const status = JSON.parse(run('status', root, '--json').stdout);
  assert.equal(status.files.find(f => f.path === 'docs/templates/history.md').state, 'customized');
});
