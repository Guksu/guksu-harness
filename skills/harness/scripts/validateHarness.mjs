#!/usr/bin/env node
// 하네스 구조 검증기 — 스킬/에이전트/플러그인 manifest의 구조적 결함을 잡는다.
// 프로젝트 스킬은 claude(.claude/skills)와 codex(.agents/skills) 양쪽 경로를 검사한다.
// 사용법: node scripts/validateHarness.mjs [하네스 루트 경로]

import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_BODY_MAX_LINES = 500;
const BUILTIN_AGENT_TYPES = new Set([
  'claude',
  'claude-code-guide',
  'Explore',
  'general-purpose',
  'Plan',
  'statusline-setup',
]);
// description은 모든 세션에 상시 로딩된다 — 트리거에 필요한 것만 남기고 초과분은 본문으로 내린다.
const DESCRIPTION_MAX_CHARS = 350;

const exists = async ({ path }) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const listDir = async ({ path }) => {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
};

const parseFrontmatter = ({ content }) => {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fields = {};
  let currentKey = null;
  for (const line of match[1].split('\n')) {
    const fieldMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (fieldMatch) {
      currentKey = fieldMatch[1];
      const rawValue = fieldMatch[2].trim();
      // 블록 스칼라 표기(>-, | 등)는 값이 다음 줄부터 시작한다
      fields[currentKey] = /^[>|][+-]?$/.test(rawValue)
        ? ''
        : rawValue.replace(/^["']|["']$/g, '');
    } else if (currentKey && /^\s+\S/.test(line)) {
      // 들여쓴 연속 줄(멀티라인 description)을 이전 키에 이어 붙인다
      fields[currentKey] = [fields[currentKey], line.trim()].filter(Boolean).join(' ');
    }
  }
  return fields;
};

const collectAgentNames = async ({ agentsRoot }) => {
  const names = new Set();
  for (const entry of await listDir({ path: agentsRoot })) {
    if (entry.isFile() && entry.name.endsWith('.md')) names.add(entry.name.replace(/\.md$/, ''));
  }
  return names;
};

const validateSkillFile = async ({ skillDir, dirName, agentNames, issues }) => {
  const skillPath = join(skillDir, 'SKILL.md');
  if (!(await exists({ path: skillPath }))) {
    issues.push({ level: 'error', path: skillPath, message: 'SKILL.md가 없다' });
    return;
  }
  const content = await readFile(skillPath, 'utf8');
  const frontmatter = parseFrontmatter({ content });

  if (!frontmatter) {
    issues.push({ level: 'error', path: skillPath, message: 'YAML frontmatter가 없다' });
  } else {
    if (!frontmatter.name) {
      issues.push({ level: 'error', path: skillPath, message: 'frontmatter에 name이 없다' });
    } else if (frontmatter.name !== dirName) {
      issues.push({
        level: 'error',
        path: skillPath,
        message: `frontmatter name(${frontmatter.name})과 디렉토리명(${dirName})이 다르다`,
      });
    }
    if (!frontmatter.description) {
      issues.push({ level: 'error', path: skillPath, message: 'frontmatter에 description이 없다' });
    } else {
      if (frontmatter.description.length > DESCRIPTION_MAX_CHARS) {
        issues.push({
          level: 'warn',
          path: skillPath,
          message: `description이 ${frontmatter.description.length}자 — ${DESCRIPTION_MAX_CHARS}자 초과분은 상시 로딩 비용이다. 트리거 표현만 남기고 본문으로 내려라`,
        });
      }
    }
  }

  const lineCount = content.split('\n').length;
  if (lineCount > SKILL_BODY_MAX_LINES) {
    issues.push({
      level: 'warn',
      path: skillPath,
      message: `SKILL.md가 ${lineCount}줄 — ${SKILL_BODY_MAX_LINES}줄 초과분은 references/로 분리하라`,
    });
  }

  const referencedPaths = [...content.matchAll(/\b(references\/[\w./-]+\.\w+)/g)].map(
    (refMatch) => refMatch[1],
  );
  for (const referencedPath of new Set(referencedPaths)) {
    if (!(await exists({ path: join(skillDir, referencedPath) }))) {
      issues.push({
        level: 'error',
        path: skillPath,
        message: `본문이 참조하는 ${referencedPath} 파일이 없다`,
      });
    }
  }

  const referencedAgentTypes = [
    ...content.matchAll(/\b(?:agentType|agent_type|subagent_type)\s*:\s*['"]([\w-]+)['"]/g),
  ].map((typeMatch) => typeMatch[1]);
  for (const agentType of new Set(referencedAgentTypes)) {
    if (BUILTIN_AGENT_TYPES.has(agentType) || agentNames.has(agentType)) continue;
    // warn인 이유: 빌트인 타입 목록은 하네스 버전에 따라 늘어난다 — 새 빌트인을 error로
    // 오탐하면 정상 하네스가 통과 기준(error 0건)을 못 넘는다.
    issues.push({
      level: 'warn',
      path: skillPath,
      message: `본문이 참조하는 에이전트 타입 ${agentType}의 정의 파일이 없다 — 커스텀 타입이면 dead link를 수정하고(.claude/agents/${agentType}.md), 새 빌트인 타입이면 검증기의 BUILTIN_AGENT_TYPES를 갱신하라`,
    });
  }

  if (dirName.includes('orchestrator') && !/^##\s*테스트 시나리오/m.test(content)) {
    issues.push({
      level: 'warn',
      path: skillPath,
      message: '오케스트레이터에 `## 테스트 시나리오` 섹션(정상 1 + 에러 1 이상)이 없다',
    });
  }
};

const validateSkillsRoot = async ({ skillsRoot, agentNames, issues }) => {
  for (const entry of await listDir({ path: skillsRoot })) {
    if (!entry.isDirectory()) continue;
    await validateSkillFile({
      skillDir: join(skillsRoot, entry.name),
      dirName: entry.name,
      agentNames,
      issues,
    });
  }
};

const validateAgents = async ({ agentsRoot, issues }) => {
  for (const entry of await listDir({ path: agentsRoot })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const agentPath = join(agentsRoot, entry.name);
    const frontmatter = parseFrontmatter({ content: await readFile(agentPath, 'utf8') });
    if (!frontmatter?.name) {
      issues.push({ level: 'error', path: agentPath, message: 'frontmatter에 name이 없다' });
    }
    if (!frontmatter?.description) {
      issues.push({ level: 'error', path: agentPath, message: 'frontmatter에 description이 없다' });
    }
  }
};

// 프로젝트 스킬 경로 — claude는 .claude/skills, codex는 .agents/skills를 읽는다.
const PROJECT_SKILL_ROOTS = [['.claude', 'skills'], ['.agents', 'skills']];
// 규칙 파일 — claude는 CLAUDE.md, codex는 AGENTS.md를 읽는다. 둘 중 하나만 있어도 된다.
const POINTER_FILES = ['CLAUDE.md', 'AGENTS.md'];

// 프로젝트에 하네스(.claude/skills·.agents/skills·agents)가 있는가. 플러그인 repo의 루트 skills/는
// 배포물이지 프로젝트 하네스가 아니므로 포인터·훅 구성 검사 대상에서 의도적으로 제외한다.
const hasProjectHarness = async ({ rootDir }) => {
  let hasSkills = false;
  for (const parts of PROJECT_SKILL_ROOTS) {
    if ((await listDir({ path: join(rootDir, ...parts) })).some((entry) => entry.isDirectory())) hasSkills = true;
  }
  const hasAgents = (await listDir({ path: join(rootDir, '.claude', 'agents') })).some(
    (entry) => entry.isFile() && entry.name.endsWith('.md'),
  );
  return hasSkills || hasAgents;
};

const validatePointerFile = async ({ rootDir, issues }) => {
  if (!(await hasProjectHarness({ rootDir }))) return;

  const present = [];
  for (const name of POINTER_FILES) {
    if (await exists({ path: join(rootDir, name) })) present.push(name);
  }
  if (present.length === 0) {
    issues.push({
      level: 'warn',
      path: join(rootDir, 'CLAUDE.md'),
      message: 'CLAUDE.md 또는 AGENTS.md가 없다 — 하네스 포인터(목표·트리거·규칙 파일 포인터)를 등록하라',
    });
    return;
  }
  for (const name of present) {
    const pointerPath = join(rootDir, name);
    const content = await readFile(pointerPath, 'utf8');
    if (!/##\s*하네스/.test(content)) {
      issues.push({
        level: 'warn',
        path: pointerPath,
        message: `${name}에 하네스 포인터 섹션(## 하네스: ...)이 없다`,
      });
    }
  }
};

// history 스킬이 번들하는 공통 템플릿 — 하네스 구축 시 프로젝트 docs/templates/로 복사된다
const COMMON_TEMPLATES = ['history.md', 'retro.md', 'handoff.md', 'loop-spec.md'];

const validateCommonTemplates = async ({ rootDir, issues }) => {
  if (!(await hasProjectHarness({ rootDir }))) return;

  let templates = COMMON_TEMPLATES;
  // 설치 추적 기록 — v3부터 .agents/, v2.x는 .claude/에 있다.
  let installPath = join(rootDir, '.agents', 'harness-install.json');
  if (!(await exists({ path: installPath }))) installPath = join(rootDir, '.claude', 'harness-install.json');
  if (await exists({ path: installPath })) {
    try {
      const install = JSON.parse(await readFile(installPath, 'utf8'));
      if (install.profile === 'minimal') templates = [];
      if (install.profile === 'basic') templates = ['history.md', 'handoff.md'];
    } catch {
      issues.push({ level: 'error', path: installPath, message: '설치 추적 JSON을 읽을 수 없다' });
    }
  }
  for (const templateName of templates) {
    const templatePath = join(rootDir, 'docs', 'templates', templateName);
    if (!(await exists({ path: templatePath }))) {
      issues.push({
        level: 'warn',
        path: templatePath,
        message: `공통 템플릿(${templateName})이 없다 — 선택한 프로필의 양식이 없다. history 스킬의 assets/templates/${templateName}을 복사하라`,
      });
    }
  }
};

// 절대 규칙 정본 — 하네스 구축 시 프로젝트 .agents/harness-core-rules.md(코어 사본)로 복사된다.
// docs/harness-rules.md는 v4부터 팀 규칙 파일이다(코어 포인터 + 팀 규칙). v3 이하는 그 경로에 코어 전문이 있었다.
const CORE_RULES_PATH = ['.agents', 'harness-core-rules.md'];
const TEAM_RULES_PATH = ['docs', 'harness-rules.md'];
const countRules = ({ content }) =>
  content.split('\n').filter((line) => /^\d+\.\s+\*\*/.test(line)).length;

const validateRulesFile = async ({ rootDir, issues }) => {
  if (!(await hasProjectHarness({ rootDir }))) return;

  const corePath = join(rootDir, ...CORE_RULES_PATH);
  const teamPath = join(rootDir, ...TEAM_RULES_PATH);
  const hasCore = await exists({ path: corePath });
  const hasTeam = await exists({ path: teamPath });
  const teamRuleCount = hasTeam ? countRules({ content: await readFile(teamPath, 'utf8') }) : 0;
  const teamHoldsCore = teamRuleCount >= 7;

  if (!hasCore) {
    issues.push({
      level: 'warn',
      path: corePath,
      message: teamHoldsCore
        ? '코어 규칙 사본(.agents/harness-core-rules.md)이 없다 — v3 구조다. npx guksu-harness update로 코어 사본을 만들고 docs/harness-rules.md를 팀 규칙 파일로 바꿔라'
        : '코어 규칙 사본(.agents/harness-core-rules.md)이 없다 — 규칙 포인터와 팀 규칙이 가리키는 파일이 없다. npx guksu-harness update로 생성하라',
    });
  } else {
    if (teamHoldsCore) {
      issues.push({
        level: 'warn',
        path: teamPath,
        message: '팀 규칙 파일에 코어 규칙 전문이 남아 있다 — 코어 규칙은 .agents/harness-core-rules.md가 정본이다. 이 파일에는 코어 포인터와 팀 규칙만 남겨라',
      });
    }
  }
  if (!hasTeam) {
    issues.push({
      level: 'warn',
      path: teamPath,
      message: '팀 규칙 파일(docs/harness-rules.md)이 없다 — 코어 포인터와 팀 규칙을 담는 파일이다. npx guksu-harness update로 생성하라',
    });
  }
};

// 훅 등록 파일 — claude는 .claude/settings.json(hooks + permissions.deny), codex는 .codex/hooks.json(hooks).
// 둘 중 어느 파일에든 등록되어 있으면 구성된 것으로 본다. 실제 실행 지원은 앱별로 다르다.
const HOOK_REGISTRIES = [
  { app: 'claude', parts: ['.claude', 'settings.json'] },
  { app: 'codex', parts: ['.codex', 'hooks.json'] },
];

const validateEnforcement = async ({ rootDir, issues }) => {
  if (!(await hasProjectHarness({ rootDir }))) return;

  const registries = [];
  for (const registry of HOOK_REGISTRIES) {
    const path = join(rootDir, ...registry.parts);
    let data = null;
    try {
      data = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      // 파일 없음/파싱 실패 — 아래에서 미구성으로 보고된다
    }
    registries.push({ ...registry, path, data });
  }
  const preToolUseCommands = registries
    .flatMap((registry) => registry.data?.hooks?.PreToolUse ?? [])
    .flatMap((entry) => entry.hooks ?? [])
    .map((hook) => hook.command ?? '')
    .join('\n');
  const reportPath = registries.find((registry) => registry.data)?.path ?? registries[0].path;
  if (!preToolUseCommands.includes('blockGitMutation')) {
    issues.push({
      level: 'warn',
      path: reportPath,
      message:
        'git 차단 훅(blockGitMutation)이 구성되지 않았다 — 프로젝트의 git 차단 정책을 확인하라 (hooks-and-permissions.md)',
    });
  }
  if (!preToolUseCommands.includes('blockSecretAccess')) {
    issues.push({
      level: 'warn',
      path: reportPath,
      message:
        '시크릿 Bash 차단 훅(blockSecretAccess)이 구성되지 않았다 — deny는 Read 도구만 막아 cat .env 우회가 열린다 (hooks-and-permissions.md)',
    });
  }
  if (!preToolUseCommands.includes('branchGuard')) {
    issues.push({
      level: 'warn',
      path: reportPath,
      message:
        '브랜치 가드 훅(branchGuard)이 구성되지 않았다 — 보호 브랜치 편집 차단이 없다 (hooks-and-permissions.md)',
    });
  }
  // Read deny는 claude 전용 권한이다. codex만 쓰는 프로젝트(codex 등록만 있음)에는 요구하지 않는다.
  const claude = registries.find((registry) => registry.app === 'claude');
  const codex = registries.find((registry) => registry.app === 'codex');
  const claudeOnlyMissing = !claude.data && codex.data;
  const denyPatterns = claude.data?.permissions?.deny ?? [];
  if (!claudeOnlyMissing && !denyPatterns.some((pattern) => pattern.includes('.env'))) {
    issues.push({
      level: 'warn',
      path: claude.path,
      message:
        '시크릿 deny 권한(.env 등)이 구성되지 않았다 — Read 도구의 민감정보 읽기를 막는 설정이 없다 (hooks-and-permissions.md)',
    });
  }
};

const validateCommandsDir = async ({ rootDir, issues }) => {
  const commandsRoot = join(rootDir, '.claude', 'commands');
  const entries = await listDir({ path: commandsRoot });
  if (entries.length > 0) {
    issues.push({
      level: 'warn',
      path: commandsRoot,
      message:
        '.claude/commands/에 파일이 있다 — 하네스는 여기에 아무것도 생성하지 않는다. 하네스 산출물이면 스킬로 옮기고, 사용자 자산이면 무시하라',
    });
  }
};

// 플러그인 repo: claude(.claude-plugin)·codex(.codex-plugin + .agents/plugins) 설명 파일의 이름·버전 일치.
const validatePluginManifests = async ({ rootDir, issues }) => {
  const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
  const claudePlugin = join(rootDir, '.claude-plugin', 'plugin.json');
  const claudeMarket = join(rootDir, '.claude-plugin', 'marketplace.json');
  const codexPlugin = join(rootDir, '.codex-plugin', 'plugin.json');
  const codexMarket = join(rootDir, '.agents', 'plugins', 'marketplace.json');
  const versions = [];

  if ((await exists({ path: claudePlugin })) && (await exists({ path: claudeMarket }))) {
    try {
      const plugin = await readJson(claudePlugin);
      const marketplace = await readJson(claudeMarket);
      versions.push({ path: claudePlugin, version: plugin.version });
      const marketplaceEntry = (marketplace.plugins ?? []).find((entry) => entry.name === plugin.name);
      if (!marketplaceEntry) {
        issues.push({ level: 'error', path: claudeMarket, message: `plugins에 ${plugin.name} 항목이 없다` });
      } else if (marketplaceEntry.version !== plugin.version) {
        issues.push({
          level: 'error',
          path: claudeMarket,
          message: `버전 불일치 — plugin.json(${plugin.version}) vs marketplace.json(${marketplaceEntry.version})`,
        });
      }
    } catch (parseError) {
      issues.push({ level: 'error', path: claudePlugin, message: `manifest JSON 파싱 실패 — ${parseError.message}` });
    }
  }

  if (await exists({ path: codexPlugin })) {
    try {
      const plugin = await readJson(codexPlugin);
      versions.push({ path: codexPlugin, version: plugin.version });
      for (const field of ['name', 'version', 'description', 'author', 'interface']) {
        if (plugin[field] == null) {
          issues.push({ level: 'error', path: codexPlugin, message: `codex plugin.json에 필수 항목 ${field}가 없다` });
        }
      }
      if (await exists({ path: codexMarket })) {
        const marketplace = await readJson(codexMarket);
        if (!(marketplace.plugins ?? []).some((entry) => entry.name === plugin.name)) {
          issues.push({ level: 'error', path: codexMarket, message: `plugins에 ${plugin.name} 항목이 없다` });
        }
      } else {
        issues.push({
          level: 'warn',
          path: codexMarket,
          message: 'codex 마켓 목록(.agents/plugins/marketplace.json)이 없다 — codex plugin marketplace add로 설치할 수 없다',
        });
      }
    } catch (parseError) {
      issues.push({ level: 'error', path: codexPlugin, message: `manifest JSON 파싱 실패 — ${parseError.message}` });
    }
  }

  const packagePath = join(rootDir, 'package.json');
  if (versions.length && (await exists({ path: packagePath }))) {
    try {
      const pkg = await readJson(packagePath);
      if (pkg.name === 'guksu-harness') versions.push({ path: packagePath, version: pkg.version });
    } catch (parseError) {
      issues.push({ level: 'error', path: packagePath, message: `package.json 파싱 실패 — ${parseError.message}` });
    }
  }
  const distinct = new Set(versions.map((entry) => entry.version));
  if (distinct.size > 1) {
    issues.push({
      level: 'error',
      path: versions[0].path,
      message: `plugin.json·package.json 버전이 다르다 — ${versions.map((entry) => `${entry.path.split('/').slice(-2).join('/')}(${entry.version})`).join(' vs ')}`,
    });
  }
};

export const validateHarness = async ({ rootDir }) => {
  const issues = [];
  const agentNames = new Set([
    ...(await collectAgentNames({ agentsRoot: join(rootDir, '.claude', 'agents') })),
    ...(await collectAgentNames({ agentsRoot: join(rootDir, 'agents') })),
  ]);
  for (const parts of PROJECT_SKILL_ROOTS) {
    await validateSkillsRoot({ skillsRoot: join(rootDir, ...parts), agentNames, issues });
  }
  await validateSkillsRoot({ skillsRoot: join(rootDir, 'skills'), agentNames, issues });
  await validateAgents({ agentsRoot: join(rootDir, '.claude', 'agents'), issues });
  await validateAgents({ agentsRoot: join(rootDir, 'agents'), issues });
  await validatePointerFile({ rootDir, issues });
  await validateCommonTemplates({ rootDir, issues });
  await validateRulesFile({ rootDir, issues });
  await validateEnforcement({ rootDir, issues });
  await validateCommandsDir({ rootDir, issues });
  await validatePluginManifests({ rootDir, issues });
  return issues;
};

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const rootDir = process.argv[2] ?? process.cwd();
  const issues = await validateHarness({ rootDir });
  for (const issue of issues) {
    console.log(`[${issue.level}] ${issue.path}: ${issue.message}`);
  }
  const errorCount = issues.filter((issue) => issue.level === 'error').length;
  console.log(`\n검사 완료 — error ${errorCount}건, warn ${issues.length - errorCount}건`);
  process.exitCode = errorCount > 0 ? 1 : 0;
}
