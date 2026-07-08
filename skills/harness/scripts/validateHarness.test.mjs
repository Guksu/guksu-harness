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

test('본문이 참조하는 에이전트 타입의 정의 파일이 없으면 경고', async () => {
  const skillBody = `---
name: demo-skill
description: "데모 스킬. 재실행 요청 시에도 사용."
---

# Demo

agent('검수', { agentType: 'qa-inspector' })
Agent(name: "runner", subagent_type: "general-purpose")
`;
  const rootDir = await makeFixture({
    files: { '.claude/skills/demo-skill/SKILL.md': skillBody },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(
    issues.some((issue) => issue.level === 'warn' && issue.message.includes('qa-inspector')),
  );
  // 빌트인 타입은 지적하지 않는다
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

test('하네스가 있는데 공통 템플릿이 없으면 템플릿별로 경고', async () => {
  const rootDir = await makeFixture({
    files: { '.claude/agents/demo-agent.md': VALID_AGENT },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(
    issues.some((issue) => issue.level === 'warn' && issue.message.includes('worklog.md')),
  );
  assert.ok(
    issues.some((issue) => issue.level === 'warn' && issue.message.includes('retro.md')),
  );
  assert.ok(
    issues.some((issue) => issue.level === 'warn' && issue.message.includes('handoff.md')),
  );
  assert.ok(
    issues.some((issue) => issue.level === 'warn' && issue.message.includes('loop-spec.md')),
  );
  assert.ok(
    issues.some((issue) => issue.level === 'warn' && issue.message.includes('digest.md')),
  );
  await rm(rootDir, { recursive: true, force: true });
});

test('공통 템플릿이 모두 있으면 경고가 없다', async () => {
  const rootDir = await makeFixture({
    files: {
      '.claude/agents/demo-agent.md': VALID_AGENT,
      'docs/templates/worklog.md': '# {작업명}\n\n## 1. 개요\n\n## 2. 작업내용\n\n## 3. 주의사항\n',
      'docs/templates/retro.md': '# 회고: {대상}\n\n## 1. 잘된 점\n\n## 2. 반복 문제\n\n## 3. 개선안\n\n## 4. 적용 결과\n',
      'docs/templates/handoff.md': '# 인계: {작업 흐름}\n\n## 1. 목표\n\n## 2. 진행 상황\n\n## 3. 시도와 결과\n\n## 4. 다음 단계\n\n## 5. 미해결 질문\n',
      'docs/templates/loop-spec.md': '# 루프: {이름}\n\n## 1. 목표\n\n## 2. 루프 설계\n\n## 3. 안전장치\n\n## 4. 실행 기록\n\n## 5. 종료 보고\n',
      'docs/templates/digest.md': '---\nsources:\n  - path: {경로}\n    hash: {해시}\n---\n\n# 다이제스트: {대상}\n\n## 1. 책임\n\n## 2. 공개 인터페이스\n\n## 3. 의존과 데이터 흐름\n\n## 4. 불변식과 함정\n',
    },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(!issues.some((issue) => issue.message.includes('공통 템플릿')));
  await rm(rootDir, { recursive: true, force: true });
});

test('하네스가 있는데 git 훅·시크릿 deny가 미구성이면 경고', async () => {
  const rootDir = await makeFixture({
    files: { '.claude/agents/demo-agent.md': VALID_AGENT },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(
    issues.some((issue) => issue.level === 'warn' && issue.message.includes('blockGitMutation')),
  );
  assert.ok(
    issues.some((issue) => issue.level === 'warn' && issue.message.includes('branchGuard')),
  );
  assert.ok(
    issues.some((issue) => issue.level === 'warn' && issue.message.includes('blockSecretAccess')),
  );
  assert.ok(
    issues.some((issue) => issue.level === 'warn' && issue.message.includes('시크릿 deny')),
  );
  await rm(rootDir, { recursive: true, force: true });
});

test('git 훅과 시크릿 deny가 구성되어 있으면 경고가 없다', async () => {
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/blockGitMutation.mjs"' },
            { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/blockSecretAccess.mjs"' },
          ],
        },
        {
          matcher: 'Edit|Write|NotebookEdit',
          hooks: [
            { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/branchGuard.mjs"' },
          ],
        },
      ],
    },
    permissions: { deny: ['Read(./.env)', 'Read(./.env.*)'] },
  };
  const rootDir = await makeFixture({
    files: {
      '.claude/agents/demo-agent.md': VALID_AGENT,
      '.claude/settings.json': JSON.stringify(settings),
    },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(!issues.some((issue) => issue.message.includes('blockGitMutation')));
  assert.ok(!issues.some((issue) => issue.message.includes('blockSecretAccess')));
  assert.ok(!issues.some((issue) => issue.message.includes('branchGuard')));
  assert.ok(!issues.some((issue) => issue.message.includes('시크릿 deny')));
  await rm(rootDir, { recursive: true, force: true });
});

test('.claude/commands/에 파일이 있으면 경고', async () => {
  const rootDir = await makeFixture({
    files: { '.claude/commands/deploy.md': '# deploy' },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(
    issues.some((issue) => issue.level === 'warn' && issue.message.includes('commands')),
  );
  await rm(rootDir, { recursive: true, force: true });
});

test('오케스트레이터 스킬에 테스트 시나리오 섹션이 없으면 경고', async () => {
  const skillBody = `---
name: demo-orchestrator
description: "데모 오케스트레이터. 재실행 요청 시에도 사용."
---

# Demo Orchestrator

## 실행 모드: Workflow
`;
  const rootDir = await makeFixture({
    files: { '.claude/skills/demo-orchestrator/SKILL.md': skillBody },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(
    issues.some((issue) => issue.level === 'warn' && issue.message.includes('테스트 시나리오')),
  );
  const withSection = await makeFixture({
    files: {
      '.claude/skills/demo-orchestrator/SKILL.md': `${skillBody}\n## 테스트 시나리오\n\n### 정상 흐름\n`,
    },
  });
  const issuesWithSection = await validateHarness({ rootDir: withSection });
  assert.ok(!issuesWithSection.some((issue) => issue.message.includes('테스트 시나리오')));
  await rm(rootDir, { recursive: true, force: true });
  await rm(withSection, { recursive: true, force: true });
});

test('멀티라인 frontmatter description을 파싱한다', async () => {
  const skillBody = `---
name: demo-skill
description: >-
  데모 스킬. 여러 줄에 걸친 설명이며
  재실행 요청 시에도 사용.
---

# Demo
`;
  const rootDir = await makeFixture({
    files: { '.claude/skills/demo-skill/SKILL.md': skillBody },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(!issues.some((issue) => issue.message.includes('description이 없다')));
  assert.ok(!issues.some((issue) => issue.message.includes('후속 작업 키워드')));
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
