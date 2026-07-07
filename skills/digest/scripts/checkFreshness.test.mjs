import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashContent, parseSources, checkFreshness } from './checkFreshness.mjs';

const makeFixture = async ({ files }) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'guksu-digest-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(rootDir, relativePath);
    await mkdir(join(absolutePath, '..'), { recursive: true });
    await writeFile(absolutePath, content);
  }
  return rootDir;
};

const makeDigest = ({ sources }) => {
  const sourceLines = sources
    .map(({ path, hash }) => `  - path: ${path}\n    hash: ${hash}`)
    .join('\n');
  return `---\nsources:\n${sourceLines}\nupdated: 2026-07-07\n---\n\n# 다이제스트: 데모\n`;
};

test('같은 내용은 같은 해시, 다른 내용은 다른 해시', () => {
  const first = hashContent({ content: 'const a = 1;\n' });
  const second = hashContent({ content: 'const a = 1;\n' });
  const changed = hashContent({ content: 'const a = 2;\n' });
  assert.equal(first, second);
  assert.notEqual(first, changed);
  assert.equal(first.length, 12);
});

test('frontmatter의 sources 목록을 파싱한다', () => {
  const sources = parseSources({
    content: makeDigest({
      sources: [
        { path: 'src/foo.ts', hash: 'aaaaaaaaaaaa' },
        { path: 'src/bar.ts', hash: 'bbbbbbbbbbbb' },
      ],
    }),
  });
  assert.deepEqual(sources, [
    { path: 'src/foo.ts', hash: 'aaaaaaaaaaaa' },
    { path: 'src/bar.ts', hash: 'bbbbbbbbbbbb' },
  ]);
});

test('frontmatter가 없으면 null을 반환한다', () => {
  assert.equal(parseSources({ content: '# 다이제스트\n\n본문.\n' }), null);
});

test('소스가 변하지 않았으면 전부 fresh', async () => {
  const sourceContent = 'export const answer = 42;\n';
  const rootDir = await makeFixture({
    files: {
      'src/foo.ts': sourceContent,
      'docs/digests/foo.md': makeDigest({
        sources: [{ path: 'src/foo.ts', hash: hashContent({ content: sourceContent }) }],
      }),
    },
  });
  const { ok, results } = await checkFreshness({
    digestPath: join(rootDir, 'docs/digests/foo.md'),
    rootDir,
  });
  assert.equal(ok, true);
  assert.deepEqual(results.map((result) => result.status), ['fresh']);
  await rm(rootDir, { recursive: true, force: true });
});

test('소스가 바뀌면 해당 소스만 stale로 판정한다', async () => {
  const keptContent = 'kept\n';
  const rootDir = await makeFixture({
    files: {
      'src/kept.ts': keptContent,
      'src/changed.ts': 'after change\n',
      'docs/digests/mixed.md': makeDigest({
        sources: [
          { path: 'src/kept.ts', hash: hashContent({ content: keptContent }) },
          { path: 'src/changed.ts', hash: hashContent({ content: 'before change\n' }) },
        ],
      }),
    },
  });
  const { ok, results } = await checkFreshness({
    digestPath: join(rootDir, 'docs/digests/mixed.md'),
    rootDir,
  });
  assert.equal(ok, false);
  assert.equal(results.find((result) => result.path === 'src/kept.ts').status, 'fresh');
  assert.equal(results.find((result) => result.path === 'src/changed.ts').status, 'stale');
  await rm(rootDir, { recursive: true, force: true });
});

test('소스 파일이 사라지면 missing으로 판정한다', async () => {
  const rootDir = await makeFixture({
    files: {
      'docs/digests/gone.md': makeDigest({
        sources: [{ path: 'src/deleted.ts', hash: 'aaaaaaaaaaaa' }],
      }),
    },
  });
  const { ok, results } = await checkFreshness({
    digestPath: join(rootDir, 'docs/digests/gone.md'),
    rootDir,
  });
  assert.equal(ok, false);
  assert.deepEqual(results.map((result) => result.status), ['missing']);
  await rm(rootDir, { recursive: true, force: true });
});

test('sources 목록이 없으면 에러를 반환한다', async () => {
  const rootDir = await makeFixture({
    files: { 'docs/digests/empty.md': '---\nupdated: 2026-07-07\n---\n\n# 빈 다이제스트\n' },
  });
  const { ok, error } = await checkFreshness({
    digestPath: join(rootDir, 'docs/digests/empty.md'),
    rootDir,
  });
  assert.equal(ok, false);
  assert.ok(error.includes('sources'));
  await rm(rootDir, { recursive: true, force: true });
});
