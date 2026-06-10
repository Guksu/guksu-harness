#!/usr/bin/env node
// 하네스 구조 검증기 — 스킬/에이전트/플러그인 manifest의 구조적 결함을 잡는다.
// 사용법: node scripts/validateHarness.mjs [하네스 루트 경로]

import { readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_BODY_MAX_LINES = 500;

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
  for (const line of match[1].split('\n')) {
    const fieldMatch = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (fieldMatch) fields[fieldMatch[1]] = fieldMatch[2].replace(/^["']|["']$/g, '');
  }
  return fields;
};

const validateSkillFile = async ({ skillDir, dirName, issues }) => {
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
};

const validateSkillsRoot = async ({ skillsRoot, issues }) => {
  for (const entry of await listDir({ path: skillsRoot })) {
    if (!entry.isDirectory()) continue;
    await validateSkillFile({
      skillDir: join(skillsRoot, entry.name),
      dirName: entry.name,
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
  await validateSkillsRoot({ skillsRoot: join(rootDir, '.claude', 'skills'), issues });
  await validateSkillsRoot({ skillsRoot: join(rootDir, 'skills'), issues });
  await validateAgents({ agentsRoot: join(rootDir, '.claude', 'agents'), issues });
  await validateAgents({ agentsRoot: join(rootDir, 'agents'), issues });
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
