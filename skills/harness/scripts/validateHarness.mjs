#!/usr/bin/env node
// 하네스 구조 검증기 — 스킬/에이전트/플러그인 manifest의 구조적 결함을 잡는다.
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
const FOLLOW_UP_KEYWORDS = ['다시', '재실행', '재구성', '수정', '보완', '업데이트', '개선'];

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
    } else if (!FOLLOW_UP_KEYWORDS.some((keyword) => frontmatter.description.includes(keyword))) {
      issues.push({
        level: 'warn',
        path: skillPath,
        message: `description에 후속 작업 키워드(${FOLLOW_UP_KEYWORDS.join('·')} 등)가 없다 — 재실행·수정 요청이 트리거되지 않는다`,
      });
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

// 프로젝트에 하네스(.claude/skills·agents)가 있는가. 플러그인 repo의 루트 skills/는
// 배포물이지 프로젝트 하네스가 아니므로 CLAUDE.md 포인터·훅 구성 검사 대상에서 의도적으로 제외한다.
const hasProjectHarness = async ({ rootDir }) => {
  const hasSkills = (await listDir({ path: join(rootDir, '.claude', 'skills') })).some((entry) =>
    entry.isDirectory(),
  );
  const hasAgents = (await listDir({ path: join(rootDir, '.claude', 'agents') })).some(
    (entry) => entry.isFile() && entry.name.endsWith('.md'),
  );
  return hasSkills || hasAgents;
};

const validateClaudeMdPointer = async ({ rootDir, issues }) => {
  if (!(await hasProjectHarness({ rootDir }))) return;

  const claudeMdPath = join(rootDir, 'CLAUDE.md');
  if (!(await exists({ path: claudeMdPath }))) {
    issues.push({
      level: 'warn',
      path: claudeMdPath,
      message: 'CLAUDE.md가 없다 — 하네스 포인터(트리거 규칙 + 변경 이력)를 등록하라 (Phase 4)',
    });
    return;
  }
  const content = await readFile(claudeMdPath, 'utf8');
  if (!/##\s*하네스/.test(content)) {
    issues.push({
      level: 'warn',
      path: claudeMdPath,
      message: 'CLAUDE.md에 하네스 포인터 섹션(## 하네스: ...)이 없다 (Phase 4)',
    });
  }
};

// docs 스킬이 번들하는 공통 템플릿 — 하네스 구축 시 프로젝트 docs/templates/로 복사된다
const COMMON_TEMPLATES = ['worklog.md', 'retro.md', 'handoff.md', 'loop-spec.md', 'digest.md'];

const validateCommonTemplates = async ({ rootDir, issues }) => {
  if (!(await hasProjectHarness({ rootDir }))) return;

  for (const templateName of COMMON_TEMPLATES) {
    const templatePath = join(rootDir, 'docs', 'templates', templateName);
    if (!(await exists({ path: templatePath }))) {
      issues.push({
        level: 'warn',
        path: templatePath,
        message: `공통 템플릿(${templateName})이 없다 — 절대 규칙 3의 기록 형식이 구성되지 않았다. docs 스킬의 assets/templates/${templateName}을 복사하라 (Phase 2)`,
      });
    }
  }
};

const validateEnforcement = async ({ rootDir, issues }) => {
  if (!(await hasProjectHarness({ rootDir }))) return;

  const settingsPath = join(rootDir, '.claude', 'settings.json');
  let settings = null;
  try {
    settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  } catch {
    // 파일 없음/파싱 실패 — 아래에서 미구성으로 보고된다
  }

  const preToolUseCommands = (settings?.hooks?.PreToolUse ?? [])
    .flatMap((entry) => entry.hooks ?? [])
    .map((hook) => hook.command ?? '')
    .join('\n');
  if (!preToolUseCommands.includes('blockGitMutation')) {
    issues.push({
      level: 'warn',
      path: settingsPath,
      message:
        'git 차단 훅(blockGitMutation)이 구성되지 않았다 — 절대 규칙 1의 기계적 강제가 없다 (hooks-and-permissions.md)',
    });
  }
  if (!preToolUseCommands.includes('branchGuard')) {
    issues.push({
      level: 'warn',
      path: settingsPath,
      message:
        '브랜치 가드 훅(branchGuard)이 구성되지 않았다 — 보호 브랜치 편집 차단이 없다 (hooks-and-permissions.md)',
    });
  }
  const denyPatterns = settings?.permissions?.deny ?? [];
  if (!denyPatterns.some((pattern) => pattern.includes('.env'))) {
    issues.push({
      level: 'warn',
      path: settingsPath,
      message:
        '시크릿 deny 권한(.env 등)이 구성되지 않았다 — 절대 규칙 6의 기계적 강제가 없다 (hooks-and-permissions.md)',
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

const validatePluginManifests = async ({ rootDir, issues }) => {
  const pluginPath = join(rootDir, '.claude-plugin', 'plugin.json');
  const marketplacePath = join(rootDir, '.claude-plugin', 'marketplace.json');
  if (!(await exists({ path: pluginPath })) || !(await exists({ path: marketplacePath }))) return;

  try {
    const plugin = JSON.parse(await readFile(pluginPath, 'utf8'));
    const marketplace = JSON.parse(await readFile(marketplacePath, 'utf8'));
    const marketplaceEntry = (marketplace.plugins ?? []).find(
      (entry) => entry.name === plugin.name,
    );
    if (!marketplaceEntry) {
      issues.push({
        level: 'error',
        path: marketplacePath,
        message: `plugins에 ${plugin.name} 항목이 없다`,
      });
    } else if (marketplaceEntry.version !== plugin.version) {
      issues.push({
        level: 'error',
        path: marketplacePath,
        message: `버전 불일치 — plugin.json(${plugin.version}) vs marketplace.json(${marketplaceEntry.version})`,
      });
    }
  } catch (parseError) {
    issues.push({
      level: 'error',
      path: pluginPath,
      message: `manifest JSON 파싱 실패 — ${parseError.message}`,
    });
  }
};

export const validateHarness = async ({ rootDir }) => {
  const issues = [];
  const agentNames = new Set([
    ...(await collectAgentNames({ agentsRoot: join(rootDir, '.claude', 'agents') })),
    ...(await collectAgentNames({ agentsRoot: join(rootDir, 'agents') })),
  ]);
  await validateSkillsRoot({ skillsRoot: join(rootDir, '.claude', 'skills'), agentNames, issues });
  await validateSkillsRoot({ skillsRoot: join(rootDir, 'skills'), agentNames, issues });
  await validateAgents({ agentsRoot: join(rootDir, '.claude', 'agents'), issues });
  await validateAgents({ agentsRoot: join(rootDir, 'agents'), issues });
  await validateClaudeMdPointer({ rootDir, issues });
  await validateCommonTemplates({ rootDir, issues });
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
