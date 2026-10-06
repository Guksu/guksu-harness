// 비교 구성. 모델·CLI·권한 모드·도구·관찰 훅은 모든 구성에 같고, 프로젝트에 설치되는 것만 다르다.
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO_ROOT } from './workspace.mjs';

const CLI = join(REPO_ROOT, 'bin', 'guksu-harness.mjs');

const runHarnessCli = (args, cwd) => {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 120000 });
  if (result.status !== 0) throw new Error(`guksu-harness ${args[0]} 실패:\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
};

// 팀이 CONTRIBUTING.md를 근거로 내릴 결정. diagnose가 묻거나 잘못 읽는 항목만 명시한다.
export const HARNESS_DECISIONS = {
  apps: 'claude',
  'protection.allowCommitPush': 'true',
  'protection.blockAttribution': 'true',
  'records.history': 'none',
  'verification.gate': 'rules',
};

// 플러그인 스킬은 현재 체크아웃에서 복사해 세션에만 불러온다(--plugin-dir). 테스트 파일은 뺀다.
// 한 벤치마크 안의 실행은 같은 사본을 쓴다.
function stagePlugin(pluginRoot) {
  const pluginDir = join(pluginRoot, 'guksu-harness');
  if (existsSync(join(pluginDir, '.claude-plugin', 'plugin.json'))) return pluginDir;
  mkdirSync(pluginDir, { recursive: true });
  cpSync(join(REPO_ROOT, '.claude-plugin'), join(pluginDir, '.claude-plugin'), { recursive: true });
  cpSync(join(REPO_ROOT, 'skills'), join(pluginDir, 'skills'), { recursive: true, filter: (source) => !source.endsWith('.test.mjs') });
  return pluginDir;
}

export const CONFIGS = {
  vanilla: {
    id: 'vanilla',
    title: '일반 Claude Code',
    description: '프로젝트에 AI 전용 지침·훅·플러그인이 없다. 팀 규칙은 실제 저장소처럼 CONTRIBUTING.md에만 있다.',
  },
  harness: {
    id: 'harness',
    title: 'guksu-harness',
    description: '현재 체크아웃의 guksu-harness compose(보호 훅 3종·Read deny·규칙 포인터·팀 정책)와 플러그인 스킬.',
    install(ctx) {
      const sets = Object.entries(HARNESS_DECISIONS).filter(([key]) => key !== 'apps').flatMap(([key, value]) => ['--set', `${key}=${value}`]);
      runHarnessCli(['compose', ctx.workspace, '--app', HARNESS_DECISIONS.apps, ...sets], ctx.workspace);
      runHarnessCli(['check', ctx.workspace], ctx.workspace);
      // README의 권장대로 백업과 검증 훅 상태 파일은 커밋하지 않는다.
      const ignore = readFileSync(ctx.path('.gitignore'), 'utf8');
      ctx.write('.gitignore', `${ignore}\n# guksu-harness\n.agents/harness-backups/\n.agents/hooks/verifierGate.*.state.json\n.agents/hooks/verifierGate.*.tmp\n`);
      return { message: 'chore: AI 에이전트 작업 규칙과 보호 훅 설정', pluginDir: stagePlugin(ctx.pluginRoot) };
    },
  },
};

export const DEFAULT_CONFIGS = ['vanilla', 'harness'];
