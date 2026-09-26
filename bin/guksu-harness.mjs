#!/usr/bin/env node
// guksu-harness 명령 — 프로젝트에 하네스 뼈대를 만들고(init) 갱신하며(update) 검사한다(check).
// 관리 로직은 skills/harness/scripts/harnessManager.mjs가 담당한다. 이 파일은 사용법과 출력만 맡는다.
// 사용법:
//   npx guksu-harness init   [프로젝트] [--app claude|codex|both] [--profile minimal|basic|collaboration] [--verifier] [--ci] [--dry-run]
//   npx guksu-harness update [프로젝트] [--profile minimal|basic|collaboration] [--only <경로,경로>] [--ci] [--dry-run]
//   npx guksu-harness status [프로젝트] [--json]
//   npx guksu-harness check  [프로젝트]            구조 검사 + 상태 진단. error가 있으면 종료 코드 1 (CI용)
//   npx guksu-harness eject  [프로젝트] <코어 파일 경로> --confirm
//   npx guksu-harness export [프로젝트] --out <묶음.json>       팀이 소유·수정한 파일을 한 파일로
//   npx guksu-harness import [프로젝트] --from <묶음.json> [--force]   다른 저장소의 팀 묶음을 가져오기
//   npx guksu-harness diagnose [프로젝트] [--json]                저장소 진단: 사실·추정·팀이 정할 것·충돌·검증 명령 후보 (읽기만)
//   npx guksu-harness compose  [프로젝트] [--app …] [--set 키=값]… [--decisions <답.json>] [--ci] [--force] [--dry-run] [--json]
//                                                                진단 + 팀 결정 → 명세(.agents/harness-team.json) → 설정·규칙·포인터·훅 생성
//   npx guksu-harness verify   [프로젝트] [--run] [--json]        작동 확인: 설정 완료 / 실행 확인 / 확인 필요 / 실패
import { realpathSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPlan, applyPlan, status, eject, isInstalled, version, corePaths, exportPreset, importPreset } from '../skills/harness/scripts/harnessManager.mjs';
import { diagnose, createCompose, applyCompose, verify, STATES, decisionCatalog, statusLabel } from '../skills/harness/scripts/teamCompose.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { validateHarness } from '../skills/harness/scripts/validateHarness.mjs';

const USAGE = `guksu-harness ${version()} — AI 코딩 에이전트용 프로젝트 작업 규칙 뼈대

  init   [프로젝트] [--app claude|codex|both] [--profile minimal|basic|collaboration] [--verifier] [--ci] [--dry-run]
         기본 minimal은 기록 양식 없이 설치한다. basic은 기록·인계 양식, collaboration은 회고·루프 양식도 추가한다.
         --ci는 하네스 구조 검사만 추가하며 제품 빌드·테스트는 실행하지 않는다. 이미 설치되어 있으면 update를 안내한다.
  update [프로젝트] [--profile minimal|basic|collaboration] [--only <경로,경로>] [--ci] [--dry-run]
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

팀 맞춤 구성 (진단 → 결정 → 명세 → 적용 → 작동 확인):
  diagnose [프로젝트] [--json]
         저장소를 읽어 확인된 사실·추정·팀이 정할 것·충돌·검증 명령 후보를 나눈다. 파일을 바꾸지 않고 민감정보 값은 읽지 않는다.
  compose  [프로젝트] [--app claude|codex|both] [--set 키=값]... [--decisions <답.json>] [--ci] [--force] [--dry-run] [--json]
         진단과 팀 결정으로 명세(.agents/harness-team.json)를 만들고, 명세에서 훅 설정값·팀 규칙 문서의 생성 구간·규칙 포인터를 만든다.
         훅·코어 규칙·등록은 init/update와 같은 방식으로 함께 설치한다. 답하지 않은 항목은 차단·최소 기본값으로 두고 미확인으로 표시한다.
         --set 예: --set protection.allowCommitPush=false --set records.history=none --set 'verification.checks=["npm test"]'
         --force는 compose 이후 직접 고친 생성 구간·설정 파일을 명세대로 다시 만든다(백업 남김).
  verify   [프로젝트] [--run] [--json]
         설정 완료 / 실행 확인 / 확인 필요 / 실패로 나눠 보여 준다. 훅 스크립트는 임시 저장소와 가짜 명령으로 시험한다.
         --run이면 명세의 검증 명령을 프로젝트에서 실제 실행한다. 실제 앱 안의 훅 실행은 항상 "확인 필요"다.

프로젝트를 생략하면 현재 디렉터리다. 세밀한 미리보기·복원은 skills/harness/scripts/harnessManager.mjs의 plan·apply·rollback을 쓴다.`;

const FLAGS = {
  init: { '--app': 'value', '--profile': 'value', '--verifier': 'flag', '--ci': 'flag', '--dry-run': 'flag' },
  update: { '--profile': 'value', '--only': 'value', '--ci': 'flag', '--dry-run': 'flag' },
  status: { '--json': 'flag' },
  check: {},
  eject: { '--confirm': 'flag' },
  export: { '--out': 'value' },
  import: { '--from': 'value', '--force': 'flag' },
  diagnose: { '--json': 'flag' },
  compose: { '--app': 'value', '--set': 'list', '--decisions': 'value', '--ci': 'flag', '--force': 'flag', '--dry-run': 'flag', '--json': 'flag' },
  verify: { '--run': 'flag', '--json': 'flag' },
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
    if (kind === 'list') { (options[arg] ??= []).push(next); continue; } // 반복 가능한 옵션(--set 키=값 …)
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
      : { profile: options['--profile'], only: options['--only']?.split(','), ci: options['--ci'] === true });
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
     저장소를 진단해 팀 결정만 묻고 설정·규칙을 함께 만들려면 npx guksu-harness diagnose → compose → verify 를 쓴다.
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
  if (command === 'diagnose') {
    const report = diagnose(project);
    if (options['--json']) { console.log(JSON.stringify(report, null, 2)); return 0; }
    printDiagnose(report);
    return 0;
  }
  if (command === 'compose') {
    const set = {};
    if (options['--decisions']) {
      const answers = JSON.parse(readFileSync(options['--decisions'], 'utf8'));
      if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('--decisions 파일은 {"키": 값} 객체여야 합니다');
      Object.assign(set, answers);
    }
    for (const pair of options['--set'] ?? []) {
      const at = pair.indexOf('=');
      if (at <= 0) throw new Error(`--set은 키=값 형태입니다: ${pair}`);
      set[pair.slice(0, at).trim()] = pair.slice(at + 1);
    }
    const plan = createCompose(project, { app: options['--app'], set, force: options['--force'] === true, ci: options['--ci'] === true });
    if (options['--json'] && options['--dry-run']) { console.log(JSON.stringify(plan, null, 2)); return plan.conflicts.some(c => c.blocking) ? 1 : 0; }
    const clean = printCompose(plan);
    if (options['--dry-run']) { console.log('\n--dry-run: 적용하지 않았습니다.'); return clean ? 0 : 1; }
    if (!clean) return 1;
    const result = applyCompose(plan);
    console.log(result.changed ? `\n적용 ${result.changed}건. 백업: ${result.backup} (되돌리기: harnessManager.mjs rollback --backup)` : '\n변경 없음 — 명세와 파일이 이미 일치합니다.');
    const issues = await validateHarness({ rootDir: project });
    const ok = printIssues(issues);
    if (plan.questions.length) console.log(`\n미확인 항목 ${plan.questions.length}건은 기본값으로 적용됐습니다: ${plan.questions.map(q => q.key).join(', ')}. 팀이 정하면 compose --set 키=값 으로 다시 구성합니다.`);
    console.log('다음: npx guksu-harness verify 로 작동을 확인합니다. --run을 붙이면 검증 명령을 실제 실행합니다.');
    if (options['--json']) console.log(JSON.stringify({ applied: result, issues }, null, 2));
    return ok ? 0 : 1;
  }
  if (command === 'verify') {
    const report = await verify(project, { run: options['--run'] === true });
    if (options['--json']) { console.log(JSON.stringify(report, null, 2)); return report.ok ? 0 : 1; }
    printVerify(report);
    return report.ok ? 0 : 1;
  }
  return 1;
}

const fmt = value => Array.isArray(value) ? (value.length ? value.map(v => typeof v === 'string' ? v : v.command ?? JSON.stringify(v)).join(', ') : '(없음)') : String(value);
function printDiagnose(report) {
  console.log(`진단 — ${report.root} (번들 ${report.bundleVersion})`);
  console.log(`\n확인된 사실 ${report.facts.length}건`);
  for (const fact of report.facts) console.log(`  - ${fact.summary}  [${fact.evidence.join(', ')}]`);
  console.log(`\n추정 ${report.assumptions.length}건 (팀이 바꿀 수 있음)`);
  for (const item of report.assumptions) console.log(`  - ${item.summary}  [${item.basis}]`);
  console.log(`\n충돌 ${report.conflicts.length}건`);
  for (const item of report.conflicts) console.log(`  - ${item.blocking ? '[적용 차단] ' : ''}${item.summary}  [${item.sources.join(', ')}]\n    → ${item.resolution}`);
  console.log(`\n검증 명령 후보 ${report.commands.length}건 (존재와 실행 가능은 다르다 — 실제 실행은 verify --run)`);
  for (const item of report.commands) console.log(`  - ${item.command}  [${item.source}] · ${item.note}`);
  for (const note of report.notes) console.log(`  · ${note}`);
  console.log(`\n팀이 정할 것 ${report.questions.length}건${report.questions.length ? '' : ' — 저장소 근거로 모두 정해졌다'}`);
  report.questions.forEach((q, index) => {
    console.log(`  ${index + 1}. [${q.key}] ${q.question}  (지금 기본값: ${fmt(q.default)}${q.conflict ? ' · 충돌' : ''})`);
    console.log(`     근거: ${q.basis}${q.evidence?.length ? ` [${q.evidence.join(', ')}]` : ''}`);
    for (const option of q.options ?? []) console.log(`     - ${fmt(option.value)}: ${option.label} — ${option.impact}`);
    if (q.impact && !q.options) console.log(`     영향: ${q.impact}`);
    if (q.hint) console.log(`     ${q.hint}`);
  });
  console.log(`\n결정 초안 (compose가 적용할 값)`);
  for (const [key, item] of Object.entries(report.decisions)) console.log(`  - ${key} = ${fmt(item.value)}  (${statusLabel(item)} — ${item.basis})`);
  console.log(`\n다음: npx guksu-harness compose <프로젝트> --dry-run 으로 변경을 미리 보고, 답은 --set 키=값 으로 넘긴다.`);
}
function printCompose(plan) {
  console.log(`구성 — 앱 ${plan.plan.app} · 프로필 ${plan.plan.profile}${plan.plan.verifier ? ' · 종료 검사 훅' : ''}`);
  console.log('\n결정');
  for (const [key, item] of Object.entries(plan.decisions)) {
    if (decisionCatalog[key]?.ask === false) continue;
    console.log(`  - ${key} = ${fmt(item.value)}  (${statusLabel(item)} — ${item.basis})`);
  }
  const changes = plan.operations.filter(op => op.action !== 'unchanged');
  console.log(`\n변경 ${changes.length}건`);
  for (const op of changes) console.log(`  ${op.action.padEnd(9)} ${op.path} — ${op.reason}`);
  if (!changes.length) console.log('  (없음)');
  const blocking = plan.conflicts.filter(c => c.blocking);
  const informational = plan.conflicts.filter(c => !c.blocking);
  if (blocking.length) {
    console.log(`\n적용을 막는 충돌 ${blocking.length}건`);
    for (const item of blocking) console.log(`  - ${item.summary}\n    → ${item.resolution}`);
  }
  if (informational.length) {
    console.log(`\n팀이 정리할 불일치 ${informational.length}건 (적용은 진행된다)`);
    for (const item of informational) console.log(`  - ${item.summary}\n    → ${item.resolution}`);
  }
  if (plan.questions.length) {
    console.log(`\n미확인 ${plan.questions.length}건 — 답이 없으면 아래 값으로 적용된다(충돌 항목은 기존 파일 값 유지)`);
    for (const q of plan.questions) console.log(`  - ${q.key} = ${fmt(q.default)}${q.conflict ? ' (충돌)' : ''} : ${q.question}`);
  }
  return blocking.length === 0;
}
function printVerify(report) {
  console.log(`작동 확인 — ${report.root} (번들 ${report.bundleVersion}${report.run ? ' · 검증 명령 실행함' : ''})`);
  for (const state of Object.keys(STATES)) {
    const items = report.items.filter(item => item.state === state);
    console.log(`\n${STATES[state]} ${items.length}건`);
    for (const item of items) console.log(`  - ${item.area} · ${item.subject}: ${item.detail.split('\n').join('\n      ')}`);
  }
  if (report.pending.length) console.log(`\n남은 팀 결정 ${report.pending.length}건: ${report.pending.join(', ')} (compose --set 키=값)`);
  console.log(`\n설정 완료는 파일·등록 검사, 실행 확인은 이 도구가 실제로 실행한 결과다. 확인 필요는 앱이나 팀 환경에서만 확인할 수 있다. ${report.ok ? '실패 없음.' : `실패 ${report.summary.failed}건.`}`);
}

// npx·npm은 node_modules/.bin/guksu-harness 심볼릭 링크로 실행한다. argv[1]은 링크 경로, import.meta.url은 실제 경로라
// 문자열 비교로는 어긋나 아무것도 하지 않고 0으로 끝난다(4.2.0 결함). 양쪽을 realpath로 맞춰 비교한다.
const toRealPath = p => { try { return realpathSync(p); } catch { return resolve(p); } };
if (process.argv[1] && toRealPath(process.argv[1]) === toRealPath(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = await run(process.argv.slice(2));
  } catch (error) {
    console.error(`실패: ${error.message}`);
    process.exitCode = 1;
  }
}
