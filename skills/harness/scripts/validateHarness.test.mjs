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

test('본문이 참조하는 에이전트 타입의 정의 파일이 없으면 에러', async () => {
  const skillBody = `---
name: demo-skill
description: "데모 스킬. 재실행 요청 시에도 사용."
---

# Demo

agent('검수', { agentType: 'qa-inspector' })
TeamCreate(members: [{ agent_type: "general-purpose" }])
`;
  const rootDir = await makeFixture({
    files: { '.claude/skills/demo-skill/SKILL.md': skillBody },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(
    issues.some((issue) => issue.level === 'error' && issue.message.includes('qa-inspector')),
  );
  // 빌트인 타입은 에러가 아니다
  assert.ok(!issues.some((issue) => issue.message.includes('general-purpose')));
  await rm(rootDir, { recursive: true, force: true });
});

test('참조하는 에이전트 정의 파일이 존재하면 에러가 없다', async () => {
  const skillBody = `---
name: demo-skill
description: "데모 스킬. 재실행 요청 시에도 사용."
---

agent('검수', { agentType: 'qa-inspector' })
`;
  const rootDir = await makeFixture({
    files: {
      '.claude/skills/demo-skill/SKILL.md': skillBody,
      '.claude/agents/qa-inspector.md': VALID_AGENT,
    },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(!issues.some((issue) => issue.message.includes('qa-inspector의 정의 파일이 없다')));
  await rm(rootDir, { recursive: true, force: true });
});

test('description에 후속 작업 키워드가 없으면 경고', async () => {
  const rootDir = await makeFixture({
    files: {
      '.claude/skills/demo-skill/SKILL.md': VALID_SKILL.replace(
        'references/detail.md 참조.',
        '본문.',
      ),
    },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(
    issues.some((issue) => issue.level === 'warn' && issue.message.includes('후속 작업 키워드')),
  );
  await rm(rootDir, { recursive: true, force: true });
});

test('하네스가 있는데 CLAUDE.md 하네스 포인터가 없으면 경고', async () => {
  const rootDir = await makeFixture({
    files: { '.claude/agents/demo-agent.md': VALID_AGENT },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(
    issues.some((issue) => issue.level === 'warn' && issue.message.includes('CLAUDE.md')),
  );
  await rm(rootDir, { recursive: true, force: true });
});

test('CLAUDE.md에 하네스 포인터 섹션이 있으면 경고가 없다', async () => {
  const rootDir = await makeFixture({
    files: {
      '.claude/agents/demo-agent.md': VALID_AGENT,
      'CLAUDE.md': '# 프로젝트\n\n## 하네스: 데모\n\n**트리거:** ...\n',
    },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(!issues.some((issue) => issue.message.includes('CLAUDE.md')));
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
