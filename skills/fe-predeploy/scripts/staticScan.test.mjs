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

test('fetch 에러 판정 — fetch를 쓰는데 .ok 검사가 전혀 없으면 warn', () => {
  const pos = scanSource(`const res = await fetch('/api/a');\nconst data = await res.json();`, { file: 'a.ts' });
  assert.ok(rulesOf(pos).includes('fetch-no-ok-check'));

  const neg = scanSource(`const res = await fetch('/api/a');\nif (!res.ok) throw new Error();`, { file: 'a.ts' });
  assert.ok(!rulesOf(neg).includes('fetch-no-ok-check'));
});

test('IME 조합 — Enter 처리에 isComposing 검사가 없으면 warn (한글 중복 제출)', () => {
  const pos = scanSource(
    `input.addEventListener('keydown', (e) => {\n  if (e.key === 'Enter') submit();\n});\ninput.removeEventListener('keydown', h);`,
    { file: 'a.ts' },
  );
  assert.ok(rulesOf(pos).includes('ime-enter-no-composing'));

  const withComposing = scanSource(
    `input.addEventListener('keydown', (e) => {\n  if (e.isComposing) return;\n  if (e.key === 'Enter') submit();\n});\ninput.removeEventListener('keydown', h);`,
    { file: 'a.ts' },
  );
  assert.ok(!rulesOf(withComposing).includes('ime-enter-no-composing'));

  const noEnter = scanSource(`el.addEventListener('keydown', trap);\nel.removeEventListener('keydown', trap);`, { file: 'a.ts' });
  assert.ok(!rulesOf(noEnter).includes('ime-enter-no-composing'));
});

test('bfcache — unload 리스너는 warn, pagehide는 통과', () => {
  const pos = scanSource(`window.addEventListener('unload', save);\nwindow.removeEventListener('unload', save);`, { file: 'a.js' });
  assert.ok(rulesOf(pos).includes('unload-listener'));

  const onunload = scanSource(`window.onunload = save;`, { file: 'a.js' });
  assert.ok(rulesOf(onunload).includes('unload-listener'));

  const neg = scanSource(`window.addEventListener('pagehide', save);\nwindow.removeEventListener('pagehide', save);`, { file: 'a.js' });
  assert.ok(!rulesOf(neg).includes('unload-listener'));
});

test('tabnabbing — target=_blank rel 누락·window.open noopener 누락은 warn', () => {
  const pos = scanSource(`<a href={url} target="_blank">go</a>`, { file: 'a.tsx' });
  assert.ok(rulesOf(pos).includes('blank-no-noopener'));

  const neg = scanSource(`<a href={url} target="_blank" rel="noopener noreferrer">go</a>`, { file: 'a.tsx' });
  assert.ok(!rulesOf(neg).includes('blank-no-noopener'));

  const open = scanSource(`window.open(url);`, { file: 'a.ts' });
  assert.ok(rulesOf(open).includes('blank-no-noopener'));

  const openSafe = scanSource(`window.open(url, '_blank', 'noopener,noreferrer');`, { file: 'a.ts' });
  assert.ok(!rulesOf(openSafe).includes('blank-no-noopener'));
});

test('모바일 뷰포트 — 100vh 사용은 warn (JS·CSS 모두)', () => {
  assert.ok(rulesOf(scanSource(`const s = { height: '100vh' };`, { file: 'a.ts' })).includes('vh-100'));
  assert.ok(rulesOf(scanSource(`.page { height: 100vh; }`, { file: 'a.css' })).includes('vh-100'));
  assert.ok(!rulesOf(scanSource(`.page { height: 100dvh; }`, { file: 'a.css' })).includes('vh-100'));
});

test('날짜 로케일 — 무인자 toLocale*·Intl.DateTimeFormat은 warn', () => {
  const pos = scanSource(`const s = date.toLocaleDateString();`, { file: 'a.ts' });
  assert.ok(rulesOf(pos).includes('date-locale-implicit'));

  const intl = scanSource(`const f = new Intl.DateTimeFormat();`, { file: 'a.ts' });
  assert.ok(rulesOf(intl).includes('date-locale-implicit'));

  const neg = scanSource(`const s = date.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });`, { file: 'a.ts' });
  assert.ok(!rulesOf(neg).includes('date-locale-implicit'));
});

test('CSS — @font-face에 font-display가 없으면 warn, CSS 파일엔 JS 규칙 미적용', () => {
  const pos = scanSource(`@font-face { font-family: A; src: url(a.woff2); }`, { file: 'a.css' });
  assert.ok(rulesOf(pos).includes('font-display-missing'));

  const neg = scanSource(`@font-face { font-family: A; src: url(a.woff2); font-display: swap; }`, { file: 'a.css' });
  assert.ok(!rulesOf(neg).includes('font-display-missing'));

  const cssNoJsRules = scanSource(`/* fetch( addEventListener( console.log( */ .a { color: red; }`, { file: 'a.css' });
  assert.ok(!rulesOf(cssNoJsRules).some((r) => ['fetch-no-ok-check', 'listener-no-cleanup', 'console-log'].includes(r)));
});

const makeFixture = async ({ next = false } = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'fe-predeploy-'));
  const deps = next ? '{ "dependencies": { "next": "15.0.0" } }' : '{ "dependencies": {} }';
  await writeFile(join(root, 'package.json'), deps);
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'node_modules', 'lib'), { recursive: true });
  await mkdir(join(root, '.next'), { recursive: true });
  await writeFile(join(root, 'src', 'app.jsx'), `setInterval(tick, 1000);\ndebugger;\n`);
  await writeFile(join(root, 'src', 'style.css'), `.page { height: 100vh; }\n`);
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
  assert.equal(scannedFiles, 2, '스캔 대상은 src/app.jsx + src/style.css 두 개여야 한다');
  assert.ok(findings.every((f) => f.file.endsWith('app.jsx') || f.file.endsWith('style.css')));
  assert.ok(rulesOf(findings).includes('interval-no-clear'));
  assert.ok(rulesOf(findings).includes('debugger'));
  assert.ok(rulesOf(findings).includes('vh-100'), 'CSS 파일도 스캔되어야 한다');
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
