import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
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

test('description이 350자를 넘으면 경고', async () => {
  const longDescription = `데모 스킬 업데이트. ${'트리거 표현을 길게 나열한다. '.repeat(25)}`;
  const rootDir = await makeFixture({
    files: {
      '.claude/skills/demo-skill/SKILL.md': VALID_SKILL.replace(
        '데모 스킬. 데모 작업 요청 시 사용.',
        longDescription,
      ),
    },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(
    issues.some((issue) => issue.level === 'warn' && issue.message.includes('상시 로딩 비용')),
  );
  await rm(rootDir, { recursive: true, force: true });
});

test('description이 350자 이내면 길이 경고가 없다', async () => {
  const rootDir = await makeFixture({
    files: {
      '.claude/skills/demo-skill/SKILL.md': VALID_SKILL.replace(
        '데모 스킬. 데모 작업 요청 시 사용.',
        '데모 스킬 업데이트. 데모 작업 요청 시 사용.',
      ),
    },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(!issues.some((issue) => issue.message.includes('상시 로딩 비용')));
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
    issues.some((issue) => issue.level === 'warn' && issue.message.includes('history.md')),
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
  await rm(rootDir, { recursive: true, force: true });
});

test('공통 템플릿이 모두 있으면 경고가 없다', async () => {
  const rootDir = await makeFixture({
    files: {
      '.claude/agents/demo-agent.md': VALID_AGENT,
      'docs/templates/history.md':
        '# {작업명}\n\n## 1. 개요\n\n## 2. 작업 내용\n\n## 3. 검증 결과\n\n## 4. 확인 필요 · 후속\n\n## 5. 주의사항\n',
      'docs/templates/retro.md': '# 회고: {대상}\n\n## 1. 잘된 점\n\n## 2. 반복 문제\n\n## 3. 개선안\n\n## 4. 적용 결과\n',
      'docs/templates/handoff.md': '# 인계: {작업 흐름}\n\n## 1. 목표\n\n## 2. 진행 상황\n\n## 3. 시도와 결과\n\n## 4. 다음 단계\n\n## 5. 미해결 질문\n',
      'docs/templates/loop-spec.md': '# 루프: {이름}\n\n## 1. 목표\n\n## 2. 루프 설계\n\n## 3. 안전장치\n\n## 4. 실행 기록\n\n## 5. 종료 보고\n',
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

test('하네스가 있는데 절대 규칙 파일이 없으면 경고', async () => {
  const rootDir = await makeFixture({
    files: { '.claude/agents/demo-agent.md': VALID_AGENT },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(
    issues.some(
      (issue) =>
        issue.level === 'warn' &&
        issue.message.includes('코어 규칙 사본(.agents/harness-core-rules.md)이 없다'),
    ),
  );
  await rm(rootDir, { recursive: true, force: true });
});

test('절대 규칙 파일의 규칙 수가 플러그인 정본보다 적으면 구버전 경고', async () => {
  const staleRules = [
    '# 하네스 절대 규칙',
    '',
    ...Array.from({ length: 3 }, (_, index) => `${index + 1}. **규칙 ${index + 1}.** 설명.`),
    '',
  ].join('\n');
  const rootDir = await makeFixture({
    files: {
      '.claude/agents/demo-agent.md': VALID_AGENT,
      '.agents/harness-core-rules.md': staleRules,
    },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(issues.some((issue) => issue.level === 'warn' && issue.message.includes('구버전')));
  await rm(rootDir, { recursive: true, force: true });
});

test('절대 규칙 파일이 플러그인 정본과 같으면 규칙 경고가 없다', async () => {
  const canonicalRules = await readFile(
    new URL('../assets/harness-rules.md', import.meta.url),
    'utf8',
  );
  const rootDir = await makeFixture({
    files: {
      '.claude/agents/demo-agent.md': VALID_AGENT,
      '.agents/harness-core-rules.md': canonicalRules,
      'docs/harness-rules.md': '# 팀 규칙\n\n코어 규칙은 `.agents/harness-core-rules.md`.\n',
    },
  });
  const issues = await validateHarness({ rootDir });
  assert.ok(!issues.some((issue) => /규칙 사본|팀 규칙 파일|코어 규칙 전문|구버전/.test(issue.message)), issues.map(i => i.message).join('\n'));
  await rm(rootDir, { recursive: true, force: true });
});

test('기본 구성에는 협업 템플릿을 요구하지 않는다', async t => {
  const rootDir = await makeFixture({ files: {
    '.claude/skills/demo-skill/SKILL.md': VALID_SKILL.replace('references/detail.md 참조.', '본문.'),
    '.claude/harness-install.json': JSON.stringify({ profile: 'basic' }),
    'docs/templates/history.md': '# History',
    'docs/templates/handoff.md': '# Handoff',
  } });
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const issues = await validateHarness({ rootDir });
  assert.equal(issues.some(issue => issue.message.includes('공통 템플릿')), false);
});

// ── codex 호환 (.agents/skills · AGENTS.md · .codex/hooks.json · .codex-plugin) ──────────────
test('codex 스킬 경로(.agents/skills)의 SKILL.md도 검사한다', async t => {
  const rootDir = await makeFixture({ files: {
    '.agents/skills/demo-skill/SKILL.md': '---\nname: demo-skill\n---\n\n# Demo\n',
  } });
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const issues = await validateHarness({ rootDir });
  assert.ok(issues.some(issue => issue.level === 'error' && issue.message.includes('description')));
});

test('AGENTS.md에 하네스 포인터가 있으면 CLAUDE.md가 없어도 포인터 경고가 없다', async t => {
  const rootDir = await makeFixture({ files: {
    '.agents/skills/demo-skill/SKILL.md': VALID_SKILL.replace('references/detail.md 참조.', '본문.'),
    'AGENTS.md': '# 프로젝트\n\n## 하네스: 데모\n',
  } });
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const issues = await validateHarness({ rootDir });
  assert.ok(!issues.some(issue => issue.message.includes('CLAUDE.md 또는 AGENTS.md')));
  assert.ok(!issues.some(issue => issue.message.includes('하네스 포인터 섹션')));
});

test('CLAUDE.md와 AGENTS.md가 둘 다 있으면 각각 포인터 섹션을 검사한다', async t => {
  const rootDir = await makeFixture({ files: {
    '.claude/agents/demo-agent.md': VALID_AGENT,
    'CLAUDE.md': '# 프로젝트\n\n## 하네스: 데모\n',
    'AGENTS.md': '# 프로젝트\n',
  } });
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const issues = await validateHarness({ rootDir });
  assert.ok(issues.some(issue => issue.level === 'warn' && issue.message.startsWith('AGENTS.md에 하네스 포인터')));
  assert.ok(!issues.some(issue => issue.message.startsWith('CLAUDE.md에 하네스 포인터')));
});

test('codex 등록 파일(.codex/hooks.json)만 있으면 훅 경고가 없고 claude 전용 deny는 요구하지 않는다', async t => {
  const hooks = { hooks: { PreToolUse: [
    { matcher: 'Bash', hooks: [
      { type: 'command', command: 'node ".agents/hooks/blockGitMutation.mjs"' },
      { type: 'command', command: 'node ".agents/hooks/blockSecretAccess.mjs"' },
    ] },
    { matcher: 'apply_patch|Edit|Write', hooks: [{ type: 'command', command: 'node ".agents/hooks/branchGuard.mjs"' }] },
  ] } };
  const rootDir = await makeFixture({ files: {
    '.agents/skills/demo-skill/SKILL.md': VALID_SKILL.replace('references/detail.md 참조.', '본문.'),
    '.codex/hooks.json': JSON.stringify(hooks),
  } });
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const issues = await validateHarness({ rootDir });
  for (const name of ['blockGitMutation', 'blockSecretAccess', 'branchGuard', '시크릿 deny']) {
    assert.ok(!issues.some(issue => issue.message.includes(name)), `${name} 경고가 없어야 한다`);
  }
});

test('claude 설정과 codex 등록이 함께 있으면 deny는 claude 설정에서 검사한다', async t => {
  const rootDir = await makeFixture({ files: {
    '.claude/agents/demo-agent.md': VALID_AGENT,
    '.claude/settings.json': JSON.stringify({ permissions: { deny: [] } }),
    '.codex/hooks.json': JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [
      { type: 'command', command: 'node ".agents/hooks/blockGitMutation.mjs"' },
      { type: 'command', command: 'node ".agents/hooks/blockSecretAccess.mjs"' },
      { type: 'command', command: 'node ".agents/hooks/branchGuard.mjs"' },
    ] }] } }),
  } });
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const issues = await validateHarness({ rootDir });
  assert.ok(issues.some(issue => issue.message.includes('시크릿 deny')));
  assert.ok(!issues.some(issue => issue.message.includes('blockGitMutation')));
});

test('.agents/harness-install.json의 기본 구성도 협업 템플릿을 요구하지 않는다', async t => {
  const rootDir = await makeFixture({ files: {
    '.agents/skills/demo-skill/SKILL.md': VALID_SKILL.replace('references/detail.md 참조.', '본문.'),
    '.agents/harness-install.json': JSON.stringify({ profile: 'basic' }),
    'docs/templates/history.md': '# History',
    'docs/templates/handoff.md': '# Handoff',
  } });
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const issues = await validateHarness({ rootDir });
  assert.equal(issues.some(issue => issue.message.includes('공통 템플릿')), false);
});

test('codex plugin.json은 필수 항목·마켓 목록·claude 버전 일치를 검사한다', async t => {
  const rootDir = await makeFixture({ files: {
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'demo', version: '1.0.0' }),
    '.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'demo', version: '1.0.0' }] }),
    '.codex-plugin/plugin.json': JSON.stringify({ name: 'demo', version: '1.1.0', description: 'd', author: { name: 'a' } }),
  } });
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const issues = await validateHarness({ rootDir });
  assert.ok(issues.some(issue => issue.level === 'error' && issue.message.includes('interface')));
  assert.ok(issues.some(issue => issue.level === 'warn' && issue.message.includes('마켓 목록')));
  assert.ok(issues.some(issue => issue.level === 'error' && issue.message.includes('버전이 다르다')));
});

test('codex 마켓 목록에 플러그인 항목이 없으면 에러', async t => {
  const rootDir = await makeFixture({ files: {
    '.codex-plugin/plugin.json': JSON.stringify({ name: 'demo', version: '1.0.0', description: 'd', author: { name: 'a' }, interface: { displayName: 'Demo' } }),
    '.agents/plugins/marketplace.json': JSON.stringify({ name: 'm', plugins: [{ name: 'other' }] }),
  } });
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const issues = await validateHarness({ rootDir });
  assert.ok(issues.some(issue => issue.level === 'error' && issue.message.includes('demo 항목이 없다')));
});

test('v3 구조(팀 규칙 파일에 코어 전문, 코어 사본 없음)는 update 안내로 경고한다', async t => {
  const canonicalRules = await readFile(new URL('../assets/harness-rules.md', import.meta.url), 'utf8');
  const rootDir = await makeFixture({ files: {
    '.claude/agents/demo-agent.md': VALID_AGENT,
    'docs/harness-rules.md': canonicalRules,
  } });
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const issues = await validateHarness({ rootDir });
  assert.ok(issues.some(issue => issue.level === 'warn' && issue.message.includes('v3 구조')));
});

test('package.json 버전이 plugin.json과 다르면 에러', async t => {
  const rootDir = await makeFixture({ files: {
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'demo', version: '1.0.0' }),
    '.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'demo', version: '1.0.0' }] }),
    'package.json': JSON.stringify({ name: 'guksu-harness', version: '1.0.1' }),
  } });
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const issues = await validateHarness({ rootDir });
  assert.ok(issues.some(issue => issue.level === 'error' && issue.message.includes('버전이 다르다')));
});
