import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateHarness } from './validateHarness.mjs';

const makeFixture = async ({ files }) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'guksu-harness-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(rootDir, relativePath);
    await mkdir(join(absolutePath, '..'), { recursive: true });
    await writeFile(absolutePath, content);
  }
  return rootDir;
};

const VALID_SKILL = `---
name: demo-skill
description: "데모 스킬. 데모 작업 요청 시 사용."
---

# Demo Skill

상세는 references/detail.md 참조.
`;

const VALID_AGENT = `---
name: demo-agent
description: "데모 에이전트."
---

# Demo Agent
`;

test('유효한 하네스는 에러가 없다', async () => {
  const rootDir = await makeFixture({
    files: {
      '.claude/skills/demo-skill/SKILL.md': VALID_SKILL,
      '.claude/skills/demo-skill/references/detail.md': '# Detail',
      '.claude/agents/demo-agent.md': VALID_AGENT,
    },
  });
  const issues = await validateHarness({ rootDir });
  assert.deepEqual(issues.filter((issue) => issue.level === 'error'), []);
  await rm(rootDir, { recursive: true, force: true });
});

test('frontmatter에 description이 없으면 에러', async () => {
  const rootDir = await makeFixture({
    files: {
      '.claude/skills/demo-skill/SKILL.md': '---\nname: demo-skill\n---\n\n# Demo\n',
    },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(
    issues.some((issue) => issue.level === 'error' && issue.message.includes('description')),
  );
  await rm(rootDir, { recursive: true, force: true });
});

test('스킬 name과 디렉토리명이 다르면 에러', async () => {
  const rootDir = await makeFixture({
    files: {
      '.claude/skills/other-name/SKILL.md': VALID_SKILL.replace(
        'references/detail.md 참조.',
        '본문.',
      ),
    },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(issues.some((issue) => issue.level === 'error' && issue.message.includes('name')));
  await rm(rootDir, { recursive: true, force: true });
});

test('본문이 참조하는 references/ 파일이 없으면 에러', async () => {
  const rootDir = await makeFixture({
    files: {
      '.claude/skills/demo-skill/SKILL.md': VALID_SKILL,
    },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(
    issues.some((issue) => issue.level === 'error' && issue.message.includes('references/detail.md')),
  );
  await rm(rootDir, { recursive: true, force: true });
});

test('SKILL.md 본문이 500줄을 넘으면 경고', async () => {
  const longBody = ['---', 'name: demo-skill', 'description: "데모"', '---', '']
    .concat(Array.from({ length: 510 }, (_, index) => `line ${index}`))
    .join('\n');
  const rootDir = await makeFixture({
    files: {
      '.claude/skills/demo-skill/SKILL.md': longBody,
    },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(issues.some((issue) => issue.level === 'warn' && issue.message.includes('500')));
  await rm(rootDir, { recursive: true, force: true });
});

test('plugin.json과 marketplace.json의 버전이 다르면 에러', async () => {
  const rootDir = await makeFixture({
    files: {
      '.claude-plugin/plugin.json': JSON.stringify({ name: 'demo', version: '1.0.0' }),
      '.claude-plugin/marketplace.json': JSON.stringify({
        name: 'demo',
        plugins: [{ name: 'demo', source: './', version: '0.9.0' }],
      }),
    },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(issues.some((issue) => issue.level === 'error' && issue.message.includes('버전')));
  await rm(rootDir, { recursive: true, force: true });
});

test('plugin 형태 repo의 skills/ 디렉토리도 검사한다', async () => {
  const rootDir = await makeFixture({
    files: {
      'skills/demo-skill/SKILL.md': '---\nname: demo-skill\n---\n\n# Demo\n',
    },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(
    issues.some((issue) => issue.level === 'error' && issue.message.includes('description')),
  );
  await rm(rootDir, { recursive: true, force: true });
});
