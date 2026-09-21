#!/usr/bin/env node
// guksu-harness 명령 — 프로젝트에 하네스 뼈대를 만들고(init) 갱신하며(update) 검사한다(check).
// 관리 로직은 skills/harness/scripts/harnessManager.mjs가 담당한다. 이 파일은 사용법과 출력만 맡는다.
// 사용법:
//   npx guksu-harness init   [프로젝트] [--app claude|codex|both] [--profile basic|collaboration] [--verifier] [--ci] [--dry-run]
//   npx guksu-harness update [프로젝트] [--only <경로,경로>] [--ci] [--dry-run]
//   npx guksu-harness status [프로젝트] [--json]
//   npx guksu-harness check  [프로젝트]            구조 검사 + 상태 진단. error가 있으면 종료 코드 1 (CI용)
//   npx guksu-harness eject  [프로젝트] <코어 파일 경로> --confirm
//   npx guksu-harness export [프로젝트] --out <묶음.json>       팀이 소유·수정한 파일을 한 파일로
//   npx guksu-harness import [프로젝트] --from <묶음.json> [--force]   다른 저장소의 팀 묶음을 가져오기
import { realpathSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlan, applyPlan, status, eject, isInstalled, version, corePaths, exportPreset, importPreset } from '../skills/harness/scripts/harnessManager.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { validateHarness } from '../skills/harness/scripts/validateHarness.mjs';

const USAGE = `guksu-harness ${version()} — AI 코딩 에이전트용 프로젝트 작업 규칙 뼈대

  init   [프로젝트] [--app claude|codex|both] [--profile basic|collaboration] [--verifier] [--ci] [--dry-run]
         뼈대를 만든다. --ci는 PR마다 check를 돌리는 GitHub Actions 워크플로를 추가한다. 이미 설치되어 있으면 update를 안내한다.
  update [프로젝트] [--only <경로,경로>] [--ci] [--dry-run]
         코어 파일을 새 버전으로 바꾼다. 팀 파일은 건드리지 않는다. 팀이 고친 문서 템플릿은 설치 원본과 3-way 병합한다.
         수정된 코어 파일과 병합이 겹치는 템플릿은 충돌로 보존한다.
  status [프로젝트] [--json]
         설치 버전·앱별 등록·파일 상태를 보여 준다. 파일을 바꾸지 않는다.
  check  [프로젝트]
         구조 검사와 상태 진단을 실행한다. error가 있으면 종료 코드 1. CI에서 쓴다.
  eject  [프로젝트] <코어 파일 경로> --confirm
         코어 파일 하나를 프로젝트 소유로 바꾼다. 이후 업데이트를 받지 않는다.
  export [프로젝트] --out <묶음.json>
         팀 규칙·훅 설정값·팀 훅·팀 스킬·고친 템플릿·CI 워크플로를 한 파일로 모은다. 코어 파일은 넣지 않는다.
  import [프로젝트] --from <묶음.json> [--force]
         묶음을 프로젝트에 쓴다. 이미 있고 내용이 다른 파일은 --force 없이는 건너뛴다. 먼저 init이 되어 있어야 한다.

프로젝트를 생략하면 현재 디렉터리다. 세밀한 미리보기·복원은 skills/harness/scripts/harnessManager.mjs의 plan·apply·rollback을 쓴다.`;

const FLAGS = {
  init: { '--app': 'value', '--profile': 'value', '--verifier': 'flag', '--ci': 'flag', '--dry-run': 'flag' },
  update: { '--only': 'value', '--ci': 'flag', '--dry-run': 'flag' },
  status: { '--json': 'flag' },
  check: {},
  eject: { '--confirm': 'flag' },
  export: { '--out': 'value' },
  import: { '--from': 'value', '--force': 'flag' },
};

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || ['-h', '--help', 'help'].includes(command)) return { command: 'help' };
  if (!FLAGS[command]) throw new Error(`알 수 없는 명령: ${command}\n\n${USAGE}`);
  const options = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const kind = FLAGS[command][arg];
    if (!kind) throw new Error(`알 수 없는 옵션: ${arg}`);
    if (kind === 'flag') { options[arg] = true; continue; }
    const next = rest[++i];
    if (!next || next.startsWith('--')) throw new Error(`${arg}에는 값이 필요합니다`);
    options[arg] = next;
  }
  return { command, positional, options };
}

const printPlan = plan => {
  for (const op of plan.operations) console.log(`${op.action.padEnd(9)} ${op.path} — ${op.reason}`);
  const conflicts = plan.operations.filter(op => op.action === 'conflict');
  if (conflicts.length) {
    console.log(`\n충돌 ${conflicts.length}건 — 적용하지 않았습니다. 코어 파일은 비교해 정리하거나 의도한 수정이면 eject로 소유를 전환하고, 템플릿은 새 버전과 직접 병합한 뒤 다시 실행하세요.`);
  }
  return conflicts.length === 0;
};

const printIssues = issues => {
  for (const issue of issues) console.log(`[${issue.level}] ${issue.path}: ${issue.message}`);
  const errors = issues.filter(issue => issue.level === 'error').length;
  console.log(`검사 완료 — error ${errors}건, warn ${issues.length - errors}건`);
  return errors === 0;
};

export async function run(argv) {
  const parsed = parseArgs(argv);
  if (parsed.command === 'help') { console.log(USAGE); return 0; }
  const { command, positional, options } = parsed;
  const projectArg = command === 'eject' && positional.length === 1 ? '.' : (positional[0] ?? '.');
  if (!existsSync(projectArg)) throw new Error(`프로젝트 디렉터리가 없습니다: ${projectArg}`);
  const project = realpathSync(projectArg);

  if (command === 'init' || command === 'update') {
    const installed = isInstalled(project);
    if (command === 'init' && installed) throw new Error('이미 설치된 프로젝트입니다. update를 사용하세요.');
    if (command === 'update' && !installed) throw new Error('설치 기록이 없습니다. init을 사용하세요.');
    const plan = createPlan(project, command === 'init'
      ? { app: options['--app'], profile: options['--profile'], verifier: options['--verifier'] ? true : undefined, ci: options['--ci'] === true }
      : { only: options['--only']?.split(','), ci: options['--ci'] === true });
    const clean = printPlan(plan);
    if (options['--dry-run']) { console.log('\n--dry-run: 적용하지 않았습니다.'); return clean ? 0 : 1; }
    if (!clean) return 1;
    const result = applyPlan(plan);
    console.log(result.changed ? `\n적용 ${result.changed}건. 백업: ${result.backup}` : '\n변경 없음.');
    const issues = await validateHarness({ rootDir: project });
    const ok = printIssues(issues);
    if (command === 'init') {
      console.log(`\n다음 할 일:
  1. 팀 규칙을 docs/harness-rules.md에 쓴다. 코어 규칙(.agents/harness-core-rules.md)은 고치지 않는다.
  2. 훅 설정값(.agents/hooks/*.config.json)을 프로젝트에 맞춘다 — 보호 브랜치, 커밋 허용 여부.
  3. .gitignore에 .agents/harness-backups/ 와 .agents/hooks/verifierGate.*.state.json 을 추가한다. .agents/harness-base/ 는 커밋한다.
  4. 앱에서 실제로 차단되는지 확인한다 (skills/harness/references/hooks-and-permissions.md §8).`);
    }
    return ok ? 0 : 1;
  }
  if (command === 'status') {
    const result = await status(project);
    if (options['--json']) { console.log(JSON.stringify(result, null, 2)); return result.issues.some(i => i.level === 'error') ? 1 : 0; }
    console.log(`번들 ${result.bundleVersion} / 설치 ${result.installedVersion ?? '추적 기록 없음'} / 앱 ${(result.apps ?? result.detectedApps).join('·')}${result.apps ? '' : ' (추정)'} / 브랜치 ${result.branch ?? '없음'}`);
    for (const hook of result.hooks) {
      const registered = Object.entries(hook.registered).map(([app, on]) => `${app} ${on ? '있음' : '없음'}`).join(' · ');
      console.log(`${hook.name}: 파일 ${hook.file}, 등록 ${registered}, 설정 ${hook.configuration}`);
    }
    for (const file of result.files.filter(file => file.state !== 'current')) console.log(`${file.path}: ${file.state} (설치 ${file.installedVersion ?? '알 수 없음'})`);
    for (const path of result.ejected) console.log(`${path}: ejected (프로젝트 소유)`);
    printIssues(result.issues);
    console.log(result.note);
    return result.issues.some(i => i.level === 'error') ? 1 : 0;
  }
  if (command === 'check') {
    const result = await status(project);
    console.log(`번들 ${result.bundleVersion} / 설치 ${result.installedVersion ?? '추적 기록 없음'}`);
    return printIssues(result.issues) ? 0 : 1;
  }
  if (command === 'eject') {
    const path = positional.length === 1 ? positional[0] : positional[1];
    if (!path) throw new Error(`eject할 코어 파일 경로를 지정하세요: ${[...corePaths].join(', ')}`);
    if (!options['--confirm']) {
      throw new Error(`eject는 되돌리기 어렵습니다. ${path}는 이후 업데이트를 받지 않습니다. 진행하려면 --confirm을 붙이세요.`);
    }
    const result = eject(project, path);
    console.log(`${result.ejected}: 프로젝트 소유로 전환했습니다. 백업: ${result.backup}\n되돌리려면 파일을 지우고 update를 실행하세요.`);
    return 0;
  }
  if (command === 'export') {
    if (!options['--out']) throw new Error('--out으로 묶음 파일 경로를 지정하세요');
    const preset = exportPreset(project);
    writeFileSync(options['--out'], `${JSON.stringify(preset, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    for (const path of Object.keys(preset.files)) console.log(`담음      ${path}`);
    for (const path of preset.skipped) console.log(`건너뜀    ${path} — 팀 묶음 대상이 아님`);
    console.log(`\n${Object.keys(preset.files).length}개 파일을 ${options['--out']}에 저장했습니다. 훅 설정값에 비밀이 없는지 확인한 뒤 공유하세요.`);
    return 0;
  }
  if (command === 'import') {
    if (!options['--from']) throw new Error('--from으로 묶음 파일 경로를 지정하세요');
    if (!isInstalled(project)) throw new Error('설치 기록이 없습니다. 먼저 init을 실행하세요.');
    const preset = JSON.parse(readFileSync(options['--from'], 'utf8'));
    const result = importPreset(project, preset, { force: options['--force'] === true });
    for (const path of result.written) console.log(`씀        ${path}`);
    for (const path of result.skipped) console.log(`건너뜀    ${path} — 이미 있고 내용이 다름 (--force로 덮어씀)`);
    for (const path of result.rejected) console.log(`거부      ${path} — 팀 묶음이 쓸 수 없는 경로`);
    console.log(result.backup ? `\n${result.written.length}개 파일을 썼습니다. 백업: ${result.backup}` : '\n쓴 파일이 없습니다.');
    const issues = await validateHarness({ rootDir: project });
    return printIssues(issues) && result.rejected.length === 0 ? 0 : 1;
  }
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await run(process.argv.slice(2));
  } catch (error) {
    console.error(`실패: ${error.message}`);
    process.exitCode = 1;
  }
}
