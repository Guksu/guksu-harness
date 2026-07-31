import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanSource, scanProject } from './staticScan.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'staticScan.mjs');

const rulesOf = (findings) => findings.map((f) => f.rule);

test('리스너 정리 — removeEventListener도 AbortController signal도 없으면 warn', () => {
  const pos = scanSource(`el.addEventListener('scroll', onScroll);`, { file: 'a.js' });
  assert.ok(rulesOf(pos).includes('listener-no-cleanup'));
  assert.equal(pos.find((f) => f.rule === 'listener-no-cleanup').severity, 'warn');

  const withRemove = scanSource(
    `el.addEventListener('scroll', onScroll);\nel.removeEventListener('scroll', onScroll);`,
    { file: 'a.js' },
  );
  assert.ok(!rulesOf(withRemove).includes('listener-no-cleanup'));

  const withSignal = scanSource(
    `const ac = new AbortController();\nel.addEventListener('scroll', onScroll, { signal: ac.signal });`,
    { file: 'a.js' },
  );
  assert.ok(!rulesOf(withSignal).includes('listener-no-cleanup'));
});

test('타이머 정리 — setInterval만 있고 clearInterval이 없으면 warn', () => {
  const pos = scanSource(`setInterval(tick, 1000);`, { file: 'a.js' });
  assert.ok(rulesOf(pos).includes('interval-no-clear'));

  const neg = scanSource(`const id = setInterval(tick, 1000);\nclearInterval(id);`, { file: 'a.js' });
  assert.ok(!rulesOf(neg).includes('interval-no-clear'));
});

test('useEffect 클린업 — 리스너·타이머·구독을 등록하는데 return이 없으면 warn', () => {
  const pos = scanSource(
    `useEffect(() => {\n  window.addEventListener('resize', onResize);\n}, []);\nfunction cleanup(){ window.removeEventListener('resize', onResize); }`,
    { file: 'a.jsx' },
  );
  assert.ok(rulesOf(pos).includes('effect-no-cleanup'));

  const withCleanup = scanSource(
    `useEffect(() => {\n  window.addEventListener('resize', onResize);\n  return () => window.removeEventListener('resize', onResize);\n}, []);`,
    { file: 'a.jsx' },
  );
  assert.ok(!rulesOf(withCleanup).includes('effect-no-cleanup'));

  const noSource = scanSource(`useEffect(() => {\n  setCount(1);\n}, []);`, { file: 'a.jsx' });
  assert.ok(!rulesOf(noSource).includes('effect-no-cleanup'));

  const subscribe = scanSource(`useEffect(() => {\n  const s = store.subscribe(fn);\n}, []);`, { file: 'a.tsx' });
  assert.ok(rulesOf(subscribe).includes('effect-no-cleanup'));
});

test('배포 잔재 — console.log는 warn, debugger는 blocker', () => {
  const logs = scanSource(`console.log('debug');\nconsole.error('err');`, { file: 'a.js' });
  assert.ok(rulesOf(logs).includes('console-log'));
  assert.ok(!rulesOf(logs).includes('debugger'));

  const dbg = scanSource(`function f(){\n  debugger;\n}`, { file: 'a.js' });
  const finding = dbg.find((f) => f.rule === 'debugger');
  assert.ok(finding);
  assert.equal(finding.severity, 'blocker');
  assert.equal(finding.line, 2);
});

test('시크릿 리터럴 — 알려진 키 패턴·긴 토큰 대입은 blocker', () => {
  for (const src of [
    `const key = 'sk_live_abcdefgh12345678';`,
    `const aws = "AKIAIOSFODNN7EXAMPLE";`,
    `const gh = 'ghp_abcdefghijklmnopqrst123456';`,
    `const apiKey = "a1b2c3d4e5f6a1b2c3d4e5f6";`,
  ]) {
    const found = scanSource(src, { file: 'a.js' });
    assert.ok(rulesOf(found).includes('secret-literal'), `미탐: ${src}`);
    assert.equal(found.find((f) => f.rule === 'secret-literal').severity, 'blocker');
  }
  // 공개 전제인 NEXT_PUBLIC env 참조는 시크릿이 아니다
  const pub = scanSource(`const url = process.env.NEXT_PUBLIC_API_URL;`, { file: 'a.js', isNext: true });
  assert.ok(!rulesOf(pub).includes('secret-literal'));
});

test('XSS 표면 — dangerouslySetInnerHTML은 warn', () => {
  const pos = scanSource(`<div dangerouslySetInnerHTML={{ __html: html }} />`, { file: 'a.tsx' });
  assert.ok(rulesOf(pos).includes('dangerous-html'));
});

test('Next.js 전용 — <img> 태그는 isNext일 때만 warn', () => {
  const src = `export default () => <img src="/a.png" alt="a" />;`;
  assert.ok(rulesOf(scanSource(src, { file: 'a.tsx', isNext: true })).includes('next-img-tag'));
  assert.ok(!rulesOf(scanSource(src, { file: 'a.tsx', isNext: false })).includes('next-img-tag'));
});

test('Next.js 전용 — use client 파일의 비공개 process.env 참조는 warn', () => {
  const pos = scanSource(`'use client';\nconst k = process.env.API_SECRET;`, { file: 'a.tsx', isNext: true });
  assert.ok(rulesOf(pos).includes('env-secret-client'));

  const pub = scanSource(`'use client';\nconst k = process.env.NEXT_PUBLIC_URL;`, { file: 'a.tsx', isNext: true });
  assert.ok(!rulesOf(pub).includes('env-secret-client'));

  const server = scanSource(`const k = process.env.API_SECRET;`, { file: 'a.ts', isNext: true });
  assert.ok(!rulesOf(server).includes('env-secret-client'));
});

const makeFixture = async ({ next = false } = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'fe-predeploy-'));
  const deps = next ? '{ "dependencies": { "next": "15.0.0" } }' : '{ "dependencies": {} }';
  await writeFile(join(root, 'package.json'), deps);
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'lib'), { recursive: true });
  await mkdir(join(root, '.next'), { recursive: true });
  await writeFile(join(root, 'src', 'app.jsx'), `setInterval(tick, 1000);\ndebugger;\n`);
  await writeFile(join(root, 'src', 'app.test.jsx'), `console.log('test debug');\ndebugger;\n`);
  await writeFile(join(root, 'node_modules', 'lib', 'x.js'), `debugger;\n`);
  await writeFile(join(root, '.next', 'chunk.js'), `debugger;\n`);
  return root;
};

test('scanProject — node_modules·.next·테스트 파일은 제외, next 감지', async () => {
  const root = await makeFixture({ next: true });
  const { findings, isNext, scannedFiles } = await scanProject(root);
  await rm(root, { recursive: true, force: true });

  assert.equal(isNext, true);
  assert.equal(scannedFiles, 1, '스캔 대상은 src/app.jsx 하나여야 한다');
  assert.ok(findings.every((f) => f.file.endsWith('app.jsx')));
  assert.ok(rulesOf(findings).includes('interval-no-clear'));
  assert.ok(rulesOf(findings).includes('debugger'));
});

test('CLI — blocker가 있으면 exit 1, --json은 파싱 가능, 클린 프로젝트는 exit 0', async () => {
  const dirty = await makeFixture();
  const r1 = spawnSync(process.execPath, [SCRIPT, dirty, '--json'], { encoding: 'utf8' });
  await rm(dirty, { recursive: true, force: true });
  assert.equal(r1.status, 1, 'blocker(debugger) 발견 시 exit 1');
  const parsed = JSON.parse(r1.stdout);
  assert.ok(Array.isArray(parsed.findings) && parsed.findings.length > 0);

  const clean = await mkdtemp(join(tmpdir(), 'fe-predeploy-clean-'));
  await writeFile(join(clean, 'package.json'), '{}');
  await mkdir(join(clean, 'src'));
  await writeFile(join(clean, 'src', 'ok.js'), `export const a = 1;\n`);
  const r2 = spawnSync(process.execPath, [SCRIPT, clean], { encoding: 'utf8' });
  await rm(clean, { recursive: true, force: true });
  assert.equal(r2.status, 0);
});
