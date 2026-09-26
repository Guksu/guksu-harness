#!/usr/bin/env node
// 팀 맞춤 하네스 구성 — 진단(diagnose) → 결정(compose --set) → 명세(.agents/harness-team.json) → 적용 → 작동 확인(verify).
// 설계: docs/design/2026-09-26-team-compose.md
//   diagnose  저장소를 읽어 사실·추정·미확인 결정·충돌·검증 명령 후보를 나눈다. 파일을 바꾸지 않고 민감정보 값은 읽지 않는다.
//   compose   진단 + 팀 결정으로 명세를 만들고, 명세에서 훅 설정값·팀 규칙 문서의 생성 구간·규칙 포인터 구간을 만든다.
//             번들 파일(훅·코어 규칙·등록·양식)은 harnessManager.createPlan에 맡기고 한 계획으로 합쳐 백업 한 건으로 적용한다.
//   verify    설정 완료 / 실행 확인 / 확인 필요 / 실패 네 상태로 나눈다. 훅 스크립트는 임시 저장소와 가짜 명령으로 시험하고,
//             실제 앱 안의 실행은 항상 "확인 필요"로 남긴다. 검증 명령은 run 옵션을 줄 때만 실행한다.
// 결정 상태: confirmed(팀이 답함) · evidence(저장소 근거) · assumed(추정) · pending(미확인 — 안전한 기본값 적용, 표시).
// 미확인 결정을 승인으로 바꾸지 않는다. 권한을 넓히는 항목의 기본값은 차단이며, 기존 파일이 허용이고 지침과 충돌하면 값을 바꾸지 않는다.
import { existsSync, readFileSync, readdirSync, realpathSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  createPlan, readManifest, detectApps, version, bundleRoot, safePath, read, hash, json, commitChanges,
  hookPath, configPath, appFiles, teamRulesPath, teamSpecPath,
} from './harnessManager.mjs';
import { validateHarness } from './validateHarness.mjs';

const apps = appFiles();
const appNames = Object.keys(apps);
const gitConfigPath = configPath(undefined, 'blockGitMutation');
const branchConfigPath = configPath(undefined, 'branchGuard');
const verifierConfigPath = configPath(undefined, 'verifierGate');
const teamRulesAsset = 'skills/harness/assets/harness-team-rules.md';
const pointerAsset = 'skills/harness/assets/pointer.md';
const MARK = { policy: 'guksu-harness:team-policy', pointer: 'guksu-harness:pointer' };
const markerStart = kind => `<!-- ${MARK[kind]} start -->`;
const markerEnd = kind => `<!-- ${MARK[kind]} end -->`;
export const STATES = { configured: '설정 완료', verified: '실행 확인', unverified: '확인 필요', failed: '실패' };
const STATUS_LABEL = { confirmed: '팀 확정', evidence: '저장소 근거', assumed: '추정', pending: '미확인 · 기본값' };
// 미확인인데 충돌이 붙어 있으면 기본값이 아니라 기존 파일 값을 그대로 둔 것이다 — 표시를 구분한다.
export const statusLabel = item => item?.status === 'pending' && item.conflict ? '미확인 · 충돌' : STATUS_LABEL[item?.status] ?? String(item?.status);

const GUIDANCE_FILES = ['CLAUDE.md', 'AGENTS.md', 'CONTRIBUTING.md', '.github/CONTRIBUTING.md', '.github/PULL_REQUEST_TEMPLATE.md', '.github/pull_request_template.md', 'docs/CONTRIBUTING.md'];
const KNOWN_PREFIXES = ['feat', 'feature', 'fix', 'bugfix', 'hotfix', 'refactor', 'docs', 'chore', 'test', 'release', 'perf', 'ci', 'build'];
const DEFAULT_PREFIXES = ['feat/', 'fix/', 'refactor/', 'docs/'];
const LONG_LIVED = ['develop', 'dev', 'staging', 'production', 'release', 'main', 'master'];
const SCRIPT_CANDIDATES = ['test', 'lint', 'typecheck', 'type-check', 'check', 'build'];
const READY_BINS = new Set(['node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'echo', 'sh', 'bash', 'make', 'true', 'false', 'git', 'tsc', 'cd']);
const INSTALL_COMMAND = /^(?:npm|pnpm|yarn|bun)\s+(?:ci|install|i)\b/;
const VERIFY_COMMAND = /\b(test|lint|build|check|typecheck|tsc|eslint|vitest|jest|pytest|cargo\s+test|go\s+test)\b/;
const GIT_WORDS = /(커밋|푸시|commit|push)/i;
const FORBID_WORDS = /(하지\s*않|하지\s*마|금지|않는다|않습니다|말\s*것|never|do\s*not|don['’]t|must\s*not|not\s+allowed|사용자가\s*(?:직접\s*)?(?:한다|합니다|수행)|사람이\s*(?:직접\s*)?(?:한다|합니다))/i;
const REQUIRE_WORDS = /(필수|요구|반드시|must|required|마다|every)/i;

// ── 결정 목록: 키·영역·질문·선택지·영향 ──────────────────────────────────────
// 질문 문장과 영향 설명은 대화 스킬이 그대로 사용자에게 보여 준다.
export const decisionCatalog = {
  apps: { area: '작업 규칙', label: '사용하는 앱', type: 'apps',
    question: '훅과 규칙 포인터를 어느 앱에 등록할까요?',
    options: [
      { value: ['claude'], label: 'Claude Code만', impact: '.claude/settings.json에 훅·Read deny를 등록하고 CLAUDE.md에 포인터를 둔다.' },
      { value: ['codex'], label: 'Codex만', impact: '.codex/hooks.json에 훅을 등록하고 AGENTS.md에 포인터를 둔다. Read deny는 없다.' },
      { value: ['claude', 'codex'], label: '둘 다', impact: '두 등록 파일과 두 포인터 파일을 관리한다. 훅 파일은 한 벌이다.' },
    ] },
  'rules.guidance': { area: '작업 규칙', label: '따라야 할 기존 지침', type: 'list', ask: false },
  'rules.baseBranch': { area: '작업 규칙', label: '기준 브랜치', type: 'string',
    question: '작업 브랜치가 갈라지고 PR이 향하는 기준 브랜치는 무엇인가요?',
    impact: '기록 게이트의 비교 기준(historyBase)과 규칙 문서의 브랜치 안내에 쓴다.' },
  'rules.branchPrefixes': { area: '작업 규칙', label: '작업 브랜치 접두어', type: 'list', ask: false },
  'protection.protectedBranches': { area: '변경 보호', label: '보호 브랜치', type: 'list',
    question: '어느 브랜치에서 AI의 직접 편집을 막을까요?',
    impact: 'branchGuard 훅이 이 브랜치 위에서 Edit·Write(Codex는 apply_patch)를 차단한다. 목록에 없는 브랜치는 보호되지 않는다.' },
  'protection.allowCommitPush': { area: '변경 보호', label: '커밋·푸시 허용', type: 'boolean',
    question: 'AI가 요청받았을 때 커밋·푸시를 해도 되나요?',
    options: [
      { value: false, label: '아니요 (기본)', impact: 'AI가 commit·push를 실행하면 blockGitMutation 훅이 차단한다. 사용자가 직접 커밋·푸시한다.' },
      { value: true, label: '예', impact: '요청이 있을 때 commit·push를 실행할 수 있다. force push·amend·rebase·reset은 계속 차단한다. 이 값은 저장소의 지속 정책이며 앱의 실행 승인과 별개다.' },
    ] },
  'protection.blockAttribution': { area: '변경 보호', label: 'AI 작성 표기 차단', type: 'boolean',
    question: '커밋 메시지의 AI 작성 표기(Co-Authored-By: Claude 등)를 차단할까요?',
    options: [
      { value: false, label: '아니요 (기본)', impact: '표기를 검사하지 않는다. commit -F 같은 간접 메시지도 허용한다.' },
      { value: true, label: '예', impact: '표기가 있는 커밋과 검사할 수 없는 간접 메시지(-F·-t·-c·-C)를 차단한다.' },
    ] },
  'verification.checks': { area: '검증', label: '완료 조건 검증 명령', type: 'checks',
    question: '작업을 끝냈다고 말하기 전에 통과해야 하는 명령은 무엇인가요?',
    impact: '규칙 문서의 완료 조건이 되고, 종료 검사 훅을 켜면 그 훅이 실행한다. 없으면 완료 조건은 요청 범위 확인만이다.' },
  'verification.gate': { area: '검증', label: '종료 검사 훅', type: 'enum', values: ['rules', 'stop-hook'],
    question: '검증 명령을 규칙으로만 요구할까요, Stop 훅으로 강제할까요?',
    options: [
      { value: 'rules', label: '규칙만 (기본)', impact: 'AI가 규칙 문서를 읽고 스스로 실행한다. 강제 장치는 없다.' },
      { value: 'stop-hook', label: 'Stop 훅', impact: 'verifierGate 훅이 턴 종료마다 명령을 실행해 실패하면 종료를 막는다. 명령당 5분 제한, 세션당 최대 10회 차단, 같은 실패 3회면 보고 후 종료.' },
    ] },
  'records.history': { area: '기록·인계', label: '작업 기록', type: 'enum', values: ['none', 'optional', 'required'],
    question: 'AI가 작업 기록(docs/history/)을 남겨야 하나요?',
    options: [
      { value: 'none', label: '요구하지 않음 (기본)', impact: '사용자가 요청할 때만 기록한다. 양식을 설치하지 않는다.' },
      { value: 'optional', label: '양식만 준비', impact: 'history·handoff 양식을 설치한다(basic 프로필). 작성 의무는 없다.' },
      { value: 'required', label: 'PR마다 필수', impact: '양식을 설치하고, 커밋·푸시가 허용되면 기록 없는 push를 훅이 차단한다(requireHistoryDoc).' },
    ] },
};
export const decisionKeys = Object.keys(decisionCatalog);

const git = (root, args) => {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
};
const readText = (root, path) => { try { return read(safePath(root, path)); } catch { return null; } };
const readJson = (root, path) => {
  const text = readText(root, path);
  if (text == null) return { exists: false, data: null, error: null };
  try { const data = JSON.parse(text); return { exists: true, data, error: null, text }; }
  catch (error) { return { exists: true, data: null, error: error.message, text }; }
};
const listDir = (root, dir) => {
  try { return readdirSync(join(root, dir)).sort(); } catch { return []; }
};
const sentences = text => text.split(/\n|(?<=[.!?。])\s+/).map(s => s.trim()).filter(Boolean);
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pointerAssetText = () => readFileSync(join(bundleRoot, pointerAsset), 'utf8');
const stripGenerated = text => Object.keys(MARK).reduce((rest, kind) =>
  rest.replace(new RegExp(`${escapeRegExp(markerStart(kind))}[\\s\\S]*?${escapeRegExp(markerEnd(kind))}`, 'g'), ''), text);
const lineOf = (text, sentence) => text.split('\n').findIndex(line => line.includes(sentence.slice(0, 40))) + 1;
const unique = list => [...new Set(list)];
const decision = (value, status, basis, evidence = [], extra = {}) => ({ value, status, basis, evidence: unique(evidence), ...extra });

// ── 진단 ───────────────────────────────────────────────────────────────────────
export function diagnose(project) {
  const root = realpathSync(project);
  const facts = [], assumptions = [], conflicts = [], notes = [];
  const fact = (id, summary, evidence, value) => facts.push({ id, summary, evidence: unique([].concat(evidence)), ...(value === undefined ? {} : { value }) });
  const assume = (id, summary, basis, value) => assumptions.push({ id, summary, basis, ...(value === undefined ? {} : { value }) });
  // blocking: 적용하면 안전하지 않거나 결과가 모호한 충돌(깨진 설정 파일·드리프트·게이트 불일치). 나머지는 팀이 정리할 불일치로 보고만 한다.
  const conflict = (id, summary, sources, resolution, blocking = false) => conflicts.push({ id, summary, sources: unique(sources), resolution, blocking });

  // 1. git — 기본 브랜치·브랜치 이름·원격. 원격 URL은 토큰이 들어갈 수 있어 이름만 본다.
  const isGit = existsSync(join(root, '.git'));
  const currentBranch = isGit ? git(root, ['branch', '--show-current']) : null;
  const refs = isGit ? (git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes']) ?? '') : '';
  const branches = unique(refs.split('\n').filter(Boolean).filter(name => !name.endsWith('/HEAD')));
  const localBranches = branches.filter(name => !name.startsWith('origin/'));
  const shortNames = unique(branches.map(name => name.replace(/^origin\//, '')));
  const originHeadRef = isGit ? git(root, ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD']) : null;
  const originHead = originHeadRef?.replace('refs/remotes/origin/', '') ?? null;
  const remotes = isGit ? (git(root, ['remote']) ?? '').split('\n').filter(Boolean) : [];
  let baseBranch = null, baseEvidence = [];
  if (originHead) { baseBranch = originHead; baseEvidence = ['git symbolic-ref refs/remotes/origin/HEAD']; }
  else if (shortNames.includes('main')) { baseBranch = 'main'; baseEvidence = ['git for-each-ref refs/heads (main 존재)']; }
  else if (shortNames.includes('master')) { baseBranch = 'master'; baseEvidence = ['git for-each-ref refs/heads (master 존재)']; }
  else if (currentBranch) { baseBranch = currentBranch; baseEvidence = ['git branch --show-current (다른 후보 없음)']; }
  if (!isGit) notes.push('git 저장소가 아니다. 브랜치 정책은 저장소를 만든 뒤 다시 진단한다.');
  else {
    fact('git.repository', `git 저장소. 현재 브랜치 ${currentBranch || '(없음·detached)'}, 원격 ${remotes.length ? remotes.join('·') : '없음'}`, ['git branch --show-current', 'git remote']);
    if (baseBranch) fact('git.baseBranch', `기준 브랜치는 ${baseBranch}이다`, baseEvidence, baseBranch);
    else notes.push('기준 브랜치를 찾지 못했다(브랜치 없음).');
  }
  const branchPrefixesFromNames = unique(shortNames.map(name => name.split('/')[0]).filter(head => KNOWN_PREFIXES.includes(head)).map(head => `${head}/`));
  const longLived = unique(shortNames.filter(name => name !== baseBranch && (LONG_LIVED.includes(name) || /^release\//.test(name))));
  const baseCandidates = unique([baseBranch, ...shortNames.filter(name => ['develop', 'dev'].includes(name))].filter(Boolean));

  // 2. 지침 문서 — 존재, 포인터 절, 정책 문구(브랜치 접두어·커밋 금지·기록 의무). 내용은 정책 문장만 근거로 남긴다.
  const guidance = [];
  const prefixLines = [], forbidLines = [], historyLines = [];
  for (const path of [...GUIDANCE_FILES, teamRulesPath]) {
    const text = readText(root, path);
    if (text == null) continue;
    const pointer = /##\s*하네스/.test(text);
    // 포인터만 있는 파일(init이 만든 양식 그대로, 또는 compose가 붙인 구간뿐)은 팀 지침이 아니다.
    const remainder = stripGenerated(text).trim();
    const pointerOnly = pointer && (remainder === '' || remainder === pointerAssetText().trim() || /^#[^\n]*$/.test(remainder));
    guidance.push({ path, pointer, pointerOnly, policySection: text.includes(markerStart('policy')) });
    // compose가 생성한 구간은 팀 지침이 아니다 — 정책 문구를 읽을 때 뺀다. 그래야 생성 결과가 다음 진단의 근거가 되지 않는다.
    for (const sentence of sentences(stripGenerated(text))) {
      const line = `${path}:${lineOf(text, sentence)}`;
      const prefixes = unique([...sentence.matchAll(/\b(feat|feature|fix|bugfix|hotfix|refactor|docs|chore|test|release|perf|ci|build)\//g)].map(m => `${m[1]}/`));
      if (prefixes.length && /(브랜치|branch)/i.test(sentence)) prefixLines.push({ line, prefixes });
      // "커밋 메시지는 …"처럼 메시지 형식을 말하는 문장은 커밋 행위의 금지가 아니다.
      const actionSentence = sentence.replace(/(커밋|commit)\s*(메시지|message)/gi, '');
      if (GIT_WORDS.test(actionSentence) && FORBID_WORDS.test(actionSentence)) forbidLines.push({ line, sentence });
      if (/docs\/history/.test(sentence) && REQUIRE_WORDS.test(sentence)) historyLines.push({ line, sentence });
    }
  }
  const guidancePaths = guidance.filter(item => item.path !== teamRulesPath && !item.pointerOnly).map(item => item.path);
  if (guidancePaths.length) fact('rules.guidance', `기존 지침 문서: ${guidancePaths.join(', ')}`, guidancePaths, guidancePaths);
  else fact('rules.guidance', '기존 지침 문서(CLAUDE.md·AGENTS.md·CONTRIBUTING·PR 템플릿)가 없다', ['저장소 루트·.github/ 조사'], []);
  for (const item of guidance.filter(item => ['CLAUDE.md', 'AGENTS.md'].includes(item.path))) {
    fact(`pointer.${item.path}`, `${item.path}에 하네스 포인터 절이 ${item.pointer ? '있다' : '없다'}`, [item.path], item.pointer);
  }

  // 3. 검증 명령 후보 — package.json 스크립트, CI 워크플로 run 단계, Makefile, 다른 생태계 표지.
  const commands = [];
  const pkg = readJson(root, 'package.json');
  let packageManager = 'npm';
  if (existsSync(join(root, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
  else if (existsSync(join(root, 'yarn.lock'))) packageManager = 'yarn';
  else if (existsSync(join(root, 'bun.lockb')) || existsSync(join(root, 'bun.lock'))) packageManager = 'bun';
  const hasNodeModules = existsSync(join(root, 'node_modules'));
  const runScript = name => packageManager === 'yarn' ? `yarn ${name}` : name === 'test' ? `${packageManager} test` : `${packageManager} run ${name}`;
  const scripts = pkg.data?.scripts && typeof pkg.data.scripts === 'object' ? pkg.data.scripts : {};
  if (pkg.error) conflict('package.invalid', 'package.json을 읽을 수 없다', ['package.json'], `JSON 오류: ${pkg.error}. 고친 뒤 다시 진단한다`);
  if (pkg.exists && !pkg.error) {
    fact('package.manager', `Node 프로젝트. 패키지 관리자 ${packageManager}${hasNodeModules ? '' : ' (node_modules 없음 — 의존성 미설치)'}`, ['package.json', 'lockfile']);
    for (const name of SCRIPT_CANDIDATES) {
      const script = scripts[name];
      if (typeof script !== 'string' || !script.trim()) continue;
      const placeholder = /no test specified/.test(script) || /^\s*exit\s+1\s*$/.test(script);
      const firstToken = script.split(/\s*(?:&&|\|\||;|\|)\s*/)[0].trim().split(/\s+/).filter(token => !token.includes('='))[0] ?? '';
      let runnable, note;
      if (placeholder) { runnable = 'placeholder'; note = 'npm 기본 자리표시자 — 실제 검사가 아니다'; }
      else if (!hasNodeModules) { runnable = 'needs-install'; note = `node_modules 없음 — ${packageManager} install 후 실행 가능`; }
      else if (READY_BINS.has(firstToken) || firstToken.startsWith('./') || existsSync(join(root, 'node_modules', '.bin', firstToken))) { runnable = 'likely'; note = '정적 검사 통과 — 실제 통과 여부는 verify --run으로 확인'; }
      else { runnable = 'missing-dep'; note = `실행 파일 ${firstToken}을(를) node_modules/.bin에서 찾지 못함`; }
      commands.push({ name, command: runScript(name), source: `package.json#scripts.${name}`, runnable, note, script });
      if (placeholder) fact(`scripts.${name}`, `${name} 스크립트는 자리표시자다(존재하지만 실행할 검사가 없음)`, [`package.json#scripts.${name}`]);
    }
    if (!commands.length) fact('scripts.none', 'package.json에 test·lint·typecheck·check·build 스크립트가 없다', ['package.json#scripts']);
  }
  const workflowDir = '.github/workflows';
  const ciBranches = [];
  const ciCommands = [];
  for (const file of listDir(root, workflowDir).filter(name => /\.ya?ml$/.test(name))) {
    const path = `${workflowDir}/${file}`;
    const text = readText(root, path) ?? '';
    ciBranches.push(...workflowBranches(text));
    for (const command of workflowCommands(text)) {
      if (INSTALL_COMMAND.test(command) || !VERIFY_COMMAND.test(command)) continue;
      ciCommands.push({ command, source: path });
    }
  }
  if (ciCommands.length) {
    fact('ci.commands', `CI가 실행하는 검증 명령: ${unique(ciCommands.map(item => item.command)).join(' · ')}`, unique(ciCommands.map(item => item.source)));
    for (const item of ciCommands) {
      const scriptRef = item.command.match(/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([\w:.-]+)/);
      const scriptName = scriptRef ? scriptRef[1] : null;
      if (scriptName && pkg.exists && !pkg.error && !scripts[scriptName] && !['ci', 'install', 'i'].includes(scriptName)) {
        conflict(`ci.missing-script.${scriptName}`, `CI가 ${item.command}을(를) 실행하지만 package.json에 ${scriptName} 스크립트가 없다`, [item.source, 'package.json#scripts'], '스크립트를 추가하거나 CI 단계를 고친다. 그때까지 완료 조건에서 제외한다');
        continue;
      }
      const existing = commands.find(entry => entry.command === item.command || (scriptName && entry.name === scriptName));
      if (existing) { existing.source = `${existing.source}, ${item.source}`; continue; }
      commands.push({ name: scriptName ?? item.command.split(/\s+/).slice(0, 2).join(' '), command: item.command, source: item.source, runnable: 'unknown', note: 'CI 단계에서 발견 — 로컬 실행 여부는 verify --run으로 확인' });
    }
  }
  const exactCiBranches = unique(ciBranches.filter(name => !/[*?]/.test(name)));
  if (exactCiBranches.length) fact('ci.branches', `CI가 감시하는 브랜치: ${exactCiBranches.join(', ')}`, [workflowDir], exactCiBranches);
  const makefile = readText(root, 'Makefile');
  if (makefile != null) {
    const makeAvailable = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['make'], { stdio: 'ignore' }).status === 0;
    for (const target of ['test', 'lint', 'check', 'build']) {
      if (!new RegExp(`^${target}\\s*:`, 'm').test(makefile) || commands.some(item => item.name === target)) continue;
      commands.push({ name: target, command: `make ${target}`, source: 'Makefile', runnable: makeAvailable ? 'likely' : 'missing-dep', note: makeAvailable ? '정적 검사 통과' : 'make 명령이 PATH에 없다' });
    }
  }
  const ecosystem = [['pyproject.toml', 'pytest', 'pytest'], ['pytest.ini', 'pytest', 'pytest'], ['Cargo.toml', 'cargo test', 'cargo-test'], ['go.mod', 'go test ./...', 'go-test']];
  for (const [marker, command, name] of ecosystem) {
    if (!existsSync(join(root, marker)) || commands.some(item => item.command === command)) continue;
    commands.push({ name, command, source: marker, runnable: 'unknown', note: `${marker}로 추정한 명령 — 팀 확인 필요` });
  }

  // 4. 기존 하네스·훅 설정·등록·명세·다른 로컬 훅·민감정보 경로(존재만).
  let manifest = null;
  try { manifest = readManifest(root); } catch (error) { conflict('manifest.invalid', '설치 추적 기록을 읽을 수 없다', ['.agents/harness-install.json'], error.message, true); }
  if (manifest?.installed) fact('harness.installed', `하네스 ${manifest.version ?? '버전 미상'} 설치됨 (프로필 ${manifest.profile ?? 'basic(기록 없음)'}, 앱 ${(manifest.apps ?? []).join('·') || '미기록'}${manifest.verifier ? ', 종료 검사 훅' : ''})`, ['.agents/harness-install.json']);
  else fact('harness.installed', '하네스 설치 기록이 없다', ['.agents/harness-install.json 없음'], false);
  const gitConfig = readJson(root, gitConfigPath);
  const branchConfig = readJson(root, branchConfigPath);
  const verifierConfig = readJson(root, verifierConfigPath);
  for (const [path, item] of [[gitConfigPath, gitConfig], [branchConfigPath, branchConfig], [verifierConfigPath, verifierConfig]]) {
    if (item.error) conflict(`config.invalid.${path}`, `${path}을(를) 읽을 수 없다(JSON 오류)`, [path], '훅은 설정 오류에 차단으로 동작한다. 파일을 고친 뒤 다시 진단한다', true);
  }
  const registries = Object.fromEntries(appNames.map(app => [app, readJson(root, apps[app].registry)]));
  for (const app of appNames) {
    const data = registries[app].data;
    if (!data) continue;
    const commandsRegistered = Object.values(data.hooks ?? {}).flat().flatMap(entry => entry?.hooks ?? []).map(hook => hook?.command ?? '');
    const ours = ['blockGitMutation', 'blockSecretAccess', 'branchGuard', 'verifierGate'].filter(name => commandsRegistered.some(command => command.includes(`/hooks/${name}.mjs`)));
    fact(`registry.${app}`, `${apps[app].registry}에 훅 등록 ${commandsRegistered.length}건${ours.length ? ` (하네스 훅: ${ours.join('·')})` : ''}`, [apps[app].registry]);
  }
  const otherHooks = ['.husky', 'lefthook.yml', '.pre-commit-config.yaml'].filter(path => existsSync(join(root, path)));
  const gitHooks = isGit ? listDir(root, '.git/hooks').filter(name => !name.endsWith('.sample')) : [];
  if (otherHooks.length || gitHooks.length) fact('hooks.local', `팀이 이미 쓰는 로컬 git 훅: ${[...otherHooks, ...gitHooks.map(name => `.git/hooks/${name}`)].join(', ')}`, [...otherHooks, ...(gitHooks.length ? ['.git/hooks'] : [])]);
  const secretFiles = listDir(root, '.').filter(name => /^\.env(?:\..+)?$/.test(name) && !/\.(?:example|sample|template|dist)$/.test(name));
  if (secretFiles.length) {
    const gitignore = readText(root, '.gitignore') ?? '';
    const ignored = /^\s*\.env/m.test(gitignore);
    fact('secrets.files', `민감정보 파일이 있다: ${secretFiles.join(', ')} (값은 읽지 않음)${ignored ? '' : ' — .gitignore에 .env 항목이 없다'}`, ['저장소 루트 파일 이름', '.gitignore']);
  }
  const spec = readJson(root, teamSpecPath);
  if (spec.error) conflict('spec.invalid', '팀 구성 명세를 읽을 수 없다', [teamSpecPath], `JSON 오류: ${spec.error}`, true);
  const existingSpec = spec.data && spec.data.schemaVersion === 1 && spec.data.decisions && typeof spec.data.decisions === 'object' ? spec.data : null;
  if (existingSpec) fact('spec.exists', `팀 구성 명세가 있다 (compose ${existingSpec.composedWith ?? '버전 미상'})`, [teamSpecPath]);
  // compose가 만든 그대로인 파일(기록된 해시와 같음)은 새로 배울 것이 없다 — 그 파일에서 나온 결정은 명세의 상태를 잇는다.
  // 파일이 그 뒤로 바뀌었으면 팀이 손댄 것이므로 드리프트 충돌이고, 새 값은 팀 정책(evidence)으로 읽는다.
  const recordedHashes = existingSpec?.generated && typeof existingSpec.generated === 'object' ? existingSpec.generated : {};
  const ours = new Set(Object.entries(recordedHashes).filter(([path, recorded]) => generatedHash(root, path) === recorded).map(([path]) => path));
  for (const [path, recorded] of Object.entries(recordedHashes)) {
    const current = generatedHash(root, path);
    if (current != null && current !== recorded) conflict(`spec.drift.${path}`, `${path}이(가) compose 이후 직접 수정되었다(명세와 다름)`, [path, teamSpecPath], 'compose --set으로 명세를 같은 값으로 맞추거나, compose --force로 명세대로 다시 생성한다(백업 남김)', true);
  }
  const specDecision = key => (existingSpec?.decisions?.[key] && decisionCatalog[key] && existingSpec.decisions[key].status in STATUS_LABEL) ? existingSpec.decisions[key] : null;
  const fromSpec = item => decision(item.value, item.status, item.basis ?? '명세', item.evidence ?? [], item.conflict ? { conflict: item.conflict } : {});
  // 팀 확정은 유지한다. 도구가 만든 파일·설치 기록(self)에서 나온 근거가 명세와 같은 값이면 명세의 상태를 잇는다(미확인은 미확인으로 남는다).
  const carry = (key, computed) => {
    const previous = specDecision(key);
    if (!previous) return computed;
    if (previous.status === 'confirmed') return fromSpec(previous);
    if (computed.self && JSON.stringify(previous.value) === JSON.stringify(computed.value)) return fromSpec(previous);
    return computed;
  };
  const detected = detectApps(root);
  const appSignals = appNames.filter(app => apps[app].signals.some(signal => existsSync(join(root, signal))));

  // 5. 결정 초안 — 근거가 있으면 evidence, 추정은 assumed, 팀만 아는 것은 pending.
  const decisions = {};
  const appEvidence = appNames.flatMap(app => apps[app].signals.filter(signal => existsSync(join(root, signal))));
  decisions.apps = carry('apps', manifest?.apps?.length ? decision(manifest.apps, 'evidence', '설치 기록의 앱', ['.agents/harness-install.json'], { self: true })
    : appSignals.length ? decision(detected, 'evidence', `앱 단서 파일: ${appEvidence.join(', ')}`, appEvidence)
    : decision(['claude'], 'pending', '앱 단서(.claude/·CLAUDE.md·.codex/·AGENTS.md)가 없다', []));

  decisions['rules.guidance'] = carry('rules.guidance', decision(guidancePaths, 'evidence', guidancePaths.length ? '저장소에 있는 지침 문서' : '지침 문서 없음', guidancePaths));

  if (!baseBranch) decisions['rules.baseBranch'] = decision('main', 'assumed', '브랜치가 없어 main으로 가정', []);
  else if (baseCandidates.length > 1) decisions['rules.baseBranch'] = decision(baseBranch, 'pending', `후보가 여럿이다: ${baseCandidates.join(', ')}`, baseEvidence, { candidates: baseCandidates });
  else decisions['rules.baseBranch'] = decision(baseBranch, 'evidence', '기본 브랜치', baseEvidence);
  decisions['rules.baseBranch'] = carry('rules.baseBranch', decisions['rules.baseBranch']);

  if (prefixLines.length) {
    const prefixes = unique(prefixLines.flatMap(item => item.prefixes));
    decisions['rules.branchPrefixes'] = decision(prefixes, 'evidence', '지침 문서에 적힌 접두어', prefixLines.map(item => item.line));
    fact('rules.branchPrefixes', `지침 문서의 브랜치 접두어: ${prefixes.join(' ')}`, prefixLines.map(item => item.line), prefixes);
  } else if (branchPrefixesFromNames.length) {
    decisions['rules.branchPrefixes'] = decision(branchPrefixesFromNames, 'assumed', '기존 브랜치 이름에서 추정', ['git for-each-ref']);
    assume('rules.branchPrefixes', `브랜치 접두어를 기존 브랜치 이름에서 추정: ${branchPrefixesFromNames.join(' ')}`, 'git for-each-ref refs/heads refs/remotes', branchPrefixesFromNames);
  } else {
    decisions['rules.branchPrefixes'] = decision(DEFAULT_PREFIXES, 'assumed', '관례가 없어 기본값', []);
    assume('rules.branchPrefixes', `브랜치 접두어 관례를 찾지 못해 기본값 ${DEFAULT_PREFIXES.join(' ')}을 쓴다`, '문서·브랜치 이름 모두 근거 없음', DEFAULT_PREFIXES);
  }
  decisions['rules.branchPrefixes'] = carry('rules.branchPrefixes', decisions['rules.branchPrefixes']);

  const configuredProtected = Array.isArray(branchConfig.data?.protectedBranches) && branchConfig.data.protectedBranches.every(item => typeof item === 'string') ? branchConfig.data.protectedBranches : null;
  const baseForProtection = decisions['rules.baseBranch'].value;
  const branchSelf = ours.has(branchConfigPath);
  if (configuredProtected) {
    if (baseForProtection && !configuredProtected.includes(baseForProtection)) {
      conflict('protection.base-unprotected', `보호 브랜치 설정(${configuredProtected.join(', ')})에 기준 브랜치 ${baseForProtection}이(가) 없다`, [branchConfigPath, ...baseEvidence], `${baseForProtection}을(를) 추가할지 팀이 확인한다. 진단은 추가한 목록을 제안한다`);
      decisions['protection.protectedBranches'] = decision(unique([baseForProtection, ...configuredProtected]), 'pending', '기존 설정에 기준 브랜치가 없어 추가를 제안', [branchConfigPath], { conflict: 'protection.base-unprotected', candidates: unique([baseForProtection, ...configuredProtected]) });
    } else decisions['protection.protectedBranches'] = decision(configuredProtected, 'evidence', branchSelf ? 'compose가 생성한 설정' : '기존 branchGuard 설정', [branchConfigPath], { self: branchSelf });
  } else if (longLived.length) {
    decisions['protection.protectedBranches'] = decision([baseForProtection], 'pending', `기준 브랜치 외에 장수 브랜치가 있다: ${longLived.join(', ')}`, baseEvidence, { candidates: unique([baseForProtection, ...longLived]) });
  } else {
    decisions['protection.protectedBranches'] = decision([baseForProtection], 'assumed', '기준 브랜치를 보호', baseEvidence);
    assume('protection.protectedBranches', `보호 브랜치를 기준 브랜치 ${baseForProtection}으로 잡는다`, baseEvidence.join(', ') || '기본값', [baseForProtection]);
  }
  decisions['protection.protectedBranches'] = carry('protection.protectedBranches', decisions['protection.protectedBranches']);

  const gitSelf = ours.has(gitConfigPath);
  const configuredAllow = typeof gitConfig.data?.allowCommitPush === 'boolean' ? gitConfig.data.allowCommitPush : null;
  if (forbidLines.length) fact('protection.guidance', `지침에 커밋·푸시 금지 문구가 있다: "${forbidLines[0].sentence.slice(0, 60)}"`, forbidLines.map(item => item.line));
  if (configuredAllow === true && forbidLines.length && specDecision('protection.allowCommitPush')?.status !== 'confirmed') {
    conflict('protection.allow-vs-guidance', '훅 설정은 커밋·푸시를 허용하지만 지침은 금지한다', [gitConfigPath, ...forbidLines.map(item => item.line)], '팀이 protection.allowCommitPush를 정한다. 답이 없으면 기존 설정 값을 바꾸지 않고 표시만 한다');
    decisions['protection.allowCommitPush'] = decision(true, 'pending', '기존 설정(허용)과 지침(금지)이 충돌', [gitConfigPath, forbidLines[0].line], { conflict: 'protection.allow-vs-guidance', self: gitSelf });
  } else if (configuredAllow != null) decisions['protection.allowCommitPush'] = decision(configuredAllow, 'evidence', gitSelf ? 'compose가 생성한 설정' : '기존 blockGitMutation 설정', [gitConfigPath], { self: gitSelf });
  else if (forbidLines.length) decisions['protection.allowCommitPush'] = decision(false, 'evidence', '지침의 커밋·푸시 금지 문구', forbidLines.map(item => item.line));
  else decisions['protection.allowCommitPush'] = decision(false, 'pending', '명시된 정책이 없다. 기본값은 차단', []);
  decisions['protection.allowCommitPush'] = carry('protection.allowCommitPush', decisions['protection.allowCommitPush']);
  if (forbidLines.length && decisions['protection.allowCommitPush'].status === 'confirmed' && decisions['protection.allowCommitPush'].value === true) notes.push(`팀 확정(커밋·푸시 허용)이 지침의 금지 문구(${forbidLines[0].line})와 다르다. 지침을 고치거나 결정을 바꾼다.`);

  const allowValue = decisions['protection.allowCommitPush'].value === true;
  const configuredAttribution = typeof gitConfig.data?.blockAttribution === 'boolean' ? gitConfig.data.blockAttribution : null;
  decisions['protection.blockAttribution'] = carry('protection.blockAttribution', configuredAttribution != null
    ? decision(configuredAttribution, 'evidence', gitSelf ? 'compose가 생성한 설정' : '기존 blockGitMutation 설정', [gitConfigPath], { self: gitSelf })
    : decision(false, allowValue ? 'pending' : 'assumed', allowValue ? '커밋 허용 시 팀이 정할 항목' : '커밋 차단 상태에서는 영향 없음', []));

  const usable = commands.filter(item => item.runnable !== 'placeholder');
  const verifierSelf = ours.has(verifierConfigPath);
  const configuredChecks = Array.isArray(verifierConfig.data?.checks) ? verifierConfig.data.checks.filter(check => check && typeof check.command === 'string') : null;
  if (configuredChecks?.length) decisions['verification.checks'] = decision(configuredChecks.map(check => ({ name: String(check.name ?? check.command), command: check.command })), 'evidence', verifierSelf ? 'compose가 생성한 설정' : '기존 verifierGate 설정의 검사 명령', [verifierConfigPath], { self: verifierSelf });
  else if (usable.length) decisions['verification.checks'] = decision(usable.map(item => ({ name: item.name, command: item.command })), 'evidence', '저장소에서 찾은 검증 명령(전부 선택)', unique(usable.flatMap(item => item.source.split(', '))));
  else decisions['verification.checks'] = decision([], 'pending', '실행할 수 있는 검증 명령을 찾지 못했다', []);
  decisions['verification.checks'] = carry('verification.checks', decisions['verification.checks']);
  if (verifierConfig.exists && !verifierConfig.error) decisions['verification.gate'] = decision('stop-hook', 'evidence', verifierSelf ? 'compose가 생성한 설정' : '기존 verifierGate 설정 파일', [verifierConfigPath], { self: verifierSelf });
  else if (decisions['verification.checks'].value.length) decisions['verification.gate'] = decision('rules', 'pending', '검증 명령은 있으나 강제 여부는 팀이 정한다', []);
  else decisions['verification.gate'] = decision('rules', 'evidence', '검증 명령이 없어 훅으로 강제할 것이 없다', []);
  decisions['verification.gate'] = carry('verification.gate', decisions['verification.gate']);
  if (specDecision('verification.gate')?.status === 'confirmed' && specDecision('verification.gate').value === 'rules' && verifierConfig.exists) {
    conflict('gate.config-vs-decision', '명세는 종료 검사 훅을 쓰지 않기로 했지만 verifierGate.config.json이 있어 게이트가 계속 동작한다', [teamSpecPath, verifierConfigPath], '설정 파일을 지우거나 verification.gate를 stop-hook으로 바꾼다', true);
  }

  const effectiveRequire = gitConfig.data?.allowCommitPush === true ? gitConfig.data.requireHistoryDoc !== false : gitConfig.data?.requireHistoryDoc === true;
  const historyDocs = listDir(root, 'docs/history').filter(name => name.endsWith('.md'));
  if (historyLines.length) fact('records.guidance', `지침에 작업 기록 의무 문구가 있다: "${historyLines[0].sentence.slice(0, 60)}"`, historyLines.map(item => item.line));
  let records;
  if (gitConfig.data && gitConfig.data.requireHistoryDoc === false && historyLines.length && !gitSelf) {
    conflict('records.guidance-vs-config', '지침은 기록을 요구하지만 훅 설정은 requireHistoryDoc: false다', [gitConfigPath, ...historyLines.map(item => item.line)], '팀이 records.history를 정한다');
    records = decision('required', 'pending', '지침(필수)과 설정(비활성)이 충돌', [gitConfigPath, historyLines[0].line], { conflict: 'records.guidance-vs-config' });
  } else if (gitConfig.data && gitConfig.data.allowCommitPush === true && effectiveRequire) {
    records = decision('required', 'evidence', gitSelf ? 'compose가 생성한 설정' : gitConfig.data.requireHistoryDoc === true ? '기존 설정 requireHistoryDoc: true' : '기존 설정의 암묵적 기본값(requireHistoryDoc 생략 = true)', [gitConfigPath], { self: gitSelf });
  } else if (historyLines.length) records = decision('required', 'evidence', '지침의 기록 의무 문구', historyLines.map(item => item.line));
  else if (gitConfig.data?.requireHistoryDoc === true) records = decision('required', 'evidence', gitSelf ? 'compose가 생성한 설정' : '기존 설정 requireHistoryDoc: true', [gitConfigPath], { self: gitSelf });
  else if (gitSelf && specDecision('records.history')) records = decision(specDecision('records.history').value, 'evidence', 'compose가 생성한 설정', [gitConfigPath], { self: true });
  else if (manifest?.installed && ['basic', 'collaboration'].includes(manifest.profile ?? 'basic')) records = decision('optional', 'evidence', `설치된 ${manifest.profile ?? 'basic'} 프로필의 기록 양식`, ['.agents/harness-install.json'], { self: true });
  else if (historyDocs.length) records = decision('optional', 'pending', `docs/history/에 기록 ${historyDocs.length}건이 있으나 의무 여부는 팀이 정한다`, ['docs/history/']);
  else records = decision('none', 'pending', '기록 정책 근거가 없다. 기본값은 요구하지 않음', []);
  decisions['records.history'] = carry('records.history', records);
  if (decisions['protection.allowCommitPush'].value !== true) decisions['records.history'].note = '커밋·푸시가 차단된 상태에서는 기록 게이트(requireHistoryDoc)가 동작하지 않는다. 규칙 문서로만 안내한다.';
  for (const item of Object.values(decisions)) delete item.self;

  const questions = decisionKeys.filter(key => decisions[key].status === 'pending' && decisionCatalog[key].ask !== false).map(key => buildQuestion(key, decisions[key]));
  return { schemaVersion: 1, root, bundleVersion: version(), facts, assumptions, conflicts, notes, commands, questions, decisions, guidance,
    environment: { packageManager: pkg.exists ? packageManager : null, nodeModules: hasNodeModules, currentBranch, detectedApps: detected } };
}

function buildQuestion(key, item) {
  const meta = decisionCatalog[key];
  const question = { key, area: meta.area, label: meta.label, question: meta.question, default: item.value, basis: item.basis, evidence: item.evidence };
  if (item.conflict) question.conflict = item.conflict;
  if (meta.options) question.options = meta.options;
  else if (item.candidates) question.options = item.candidates.map(value => ({ value, label: value, impact: meta.impact }));
  else question.impact = meta.impact;
  if (key === 'protection.protectedBranches' && item.candidates) question.options = [{ value: item.candidates, label: `모두 (${item.candidates.join(', ')})`, impact: meta.impact }, ...item.candidates.map(value => ({ value: [value], label: `${value}만`, impact: meta.impact }))];
  if (key === 'verification.checks') question.hint = '예: --set \'verification.checks=["npm test","npm run lint"]\' 또는 명령 하나. 없으면 --set verification.checks=[] 로 확정한다.';
  return question;
}

// GitHub Actions 워크플로의 run 단계와 branches 목록을 가볍게 읽는다. YAML 전체 파서가 아니며 흔한 형태만 다룬다.
export function workflowCommands(text) {
  const commands = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
    if (!match) continue;
    const indent = match[1].length;
    const rest = match[2].trim();
    if (/^[|>][+-]?$/.test(rest)) {
      for (let j = i + 1; j < lines.length; j++) {
        if (!lines[j].trim()) continue;
        if (lines[j].match(/^\s*/)[0].length <= indent) break;
        commands.push(lines[j].trim());
      }
    } else if (rest) commands.push(rest.replace(/^(["'])(.*)\1$/, '$2'));
  }
  return commands;
}
export function workflowBranches(text) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*branches:\s*(.*)$/);
    if (!match) continue;
    const inline = match[1].trim();
    if (inline.startsWith('[')) { out.push(...inline.replace(/[[\]]/g, '').split(',').map(item => item.trim().replace(/^(["'])(.*)\1$/, '$2')).filter(Boolean)); continue; }
    for (let j = i + 1; j < lines.length; j++) {
      const item = lines[j].match(/^\s*-\s*(.+)$/);
      if (!item) break;
      out.push(item[1].trim().replace(/^(["'])(.*)\1$/, '$2'));
    }
  }
  return unique(out);
}

// ── 생성 구간과 해시 ──────────────────────────────────────────────────────────
function sectionOf(text, kind) {
  if (text == null) return null;
  const start = text.indexOf(markerStart(kind));
  const end = text.indexOf(markerEnd(kind));
  if (start < 0 || end < 0 || end < start) return null;
  return text.slice(start + markerStart(kind).length, end);
}
function replaceSection(text, kind, body) {
  const block = `${markerStart(kind)}${body}${markerEnd(kind)}`;
  if (text == null) return `${block}\n`;
  const start = text.indexOf(markerStart(kind));
  const end = text.indexOf(markerEnd(kind));
  if (start >= 0 && end >= start) return `${text.slice(0, start)}${block}${text.slice(end + markerEnd(kind).length)}`;
  return `${text.replace(/\s*$/, '')}\n\n${block}\n`;
}
const sectionKind = path => path === teamRulesPath ? 'policy' : appNames.some(app => apps[app].pointer === path) ? 'pointer' : null;
// 명세에 기록하는 해시: 설정 파일은 내용 전체, 문서는 생성 구간만(구간 밖 팀 수정은 드리프트가 아니다).
function generatedHashOf(path, content) {
  if (content == null) return null;
  const kind = sectionKind(path);
  if (!kind) return hash(content);
  const body = sectionOf(content, kind);
  return body == null ? null : hash(body);
}
const generatedHash = (root, path) => generatedHashOf(path, readText(root, path));

const code = value => `\`${value}\``;
const tag = item => `(${statusLabel(item)}${item.basis ? ` — ${item.basis}` : ''})`;
// 규칙 문서의 생성 구간. 모든 문장은 명세에서만 나온다 — 환경에 따라 달라지는 값(실행 결과 등)은 넣지 않는다.
export function renderPolicySection(decisions, { profile } = {}) {
  const d = key => decisions[key];
  const lines = [];
  lines.push('', '## 팀 정책 (guksu-harness compose가 생성)', '',
    `이 구간은 ${code(teamSpecPath)}에서 만들어진다. 정책을 바꾸려면 ${code('npx guksu-harness compose --set <키>=<값>')}을 쓴다. 이 구간 밖은 팀이 자유롭게 쓴다.`, '');
  lines.push('### 작업 규칙');
  const guidance = d('rules.guidance').value;
  lines.push(guidance.length ? `- 따라야 할 기존 지침: ${guidance.map(code).join(', ')}. 이 문서의 규칙과 충돌하면 팀에 확인한다.` : '- 따라야 할 별도 지침 문서는 없다. 이 문서가 팀 규칙이다.');
  lines.push(`- 작업 브랜치: ${d('rules.branchPrefixes').value.map(code).join(' ')} 접두어를 쓰고 기준 브랜치 ${code(d('rules.baseBranch').value)}에서 갈라진다. ${tag(d('rules.branchPrefixes'))}`);
  const allow = d('protection.allowCommitPush').value === true;
  const checks = d('verification.checks').value;
  lines.push(`- AI의 작업 범위: 요청 범위의 구현과 ${checks.length ? '아래 완료 조건 검증' : '결과 확인'}까지. ${allow ? '커밋·푸시는 요청이 있을 때만 한다. PR·머지는 요청이 없으면 하지 않는다.' : '커밋·푸시·PR은 사용자가 한다.'} 민감정보 값은 읽지 않는다.`);
  lines.push('', '### 변경 보호');
  lines.push(`- 보호 브랜치: ${d('protection.protectedBranches').value.map(code).join(', ')}. 이 브랜치 위에서는 파일을 편집하지 않는다(branchGuard 훅이 차단). ${tag(d('protection.protectedBranches'))}`);
  lines.push(`- 커밋·푸시: ${allow ? '요청 시 허용' : '차단 — 사용자가 직접 한다'}(blockGitMutation 훅). force push·amend·rebase·reset·checkout은 항상 차단. ${tag(d('protection.allowCommitPush'))}`);
  if (allow) lines.push(`- AI 작성 표기 차단: ${d('protection.blockAttribution').value ? '켬' : '끔'}. ${tag(d('protection.blockAttribution'))}`);
  lines.push('', '### 검증');
  if (checks.length) {
    lines.push(`- 완료 조건: 아래 명령이 모두 통과해야 작업을 완료로 보고한다. 실행하지 못한 명령은 미실행으로 밝힌다. ${tag(d('verification.checks'))}`);
    for (const check of checks) lines.push(`  - ${code(check.command)}`);
  } else lines.push(`- 완료 조건: 실행할 검증 명령이 정해지지 않았다. 요청 범위가 충족됐는지 확인하고, 실행한 검사와 하지 않은 검사를 밝힌다. ${tag(d('verification.checks'))}`);
  lines.push(`- 종료 검사 훅(verifierGate): ${d('verification.gate').value === 'stop-hook' ? '사용 — 위 명령이 실패하면 턴 종료를 막는다' : '사용 안 함 — 규칙으로만 요구한다'}. ${tag(d('verification.gate'))}`);
  lines.push('', '### 기록·인계');
  const history = d('records.history').value;
  const historyText = history === 'required' ? `PR마다 ${code('docs/history/')} 기록 한 건을 남긴다${allow ? '(기록 없는 push는 훅이 차단)' : '(커밋·푸시가 차단되어 훅 게이트는 동작하지 않음)'}` : history === 'optional' ? `양식은 준비하되 작성 의무는 없다. 사용자가 요청할 때 ${code('docs/history/')}에 남긴다` : '요구하지 않는다. 사용자가 요청할 때만 작성한다';
  lines.push(`- 작업 기록: ${historyText}. ${tag(d('records.history'))}`);
  if (history !== 'none' && profile === 'minimal') lines.push(`- 기록 양식(docs/templates/)은 설치되지 않았다. 필요하면 ${code('npx guksu-harness update --profile basic')}으로 추가한다.`);
  const pending = decisionKeys.filter(key => decisions[key].status === 'pending' && decisionCatalog[key].ask !== false);
  lines.push('');
  lines.push(pending.length ? `미확인 항목 ${pending.length}건: ${pending.map(code).join(', ')} — 기본값으로 적용되어 있다. ${code('npx guksu-harness diagnose')}가 질문과 영향을 보여 준다.` : '미확인 항목: 없음.');
  lines.push('');
  return lines.join('\n');
}
function renderPointerSection() {
  const asset = readFileSync(join(bundleRoot, pointerAsset), 'utf8');
  const body = asset.replace(/^# .*\n+/, '').trim();
  return `\n${body}\n`;
}

// ── 결정 값 검증·파싱 ─────────────────────────────────────────────────────────
export function parseDecisionValue(key, raw) {
  const meta = decisionCatalog[key];
  if (!meta) throw new Error(`알 수 없는 결정 키: ${key}. 가능한 키: ${decisionKeys.join(', ')}`);
  let value = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (/^(\[|\{|true$|false$)/.test(text)) { try { value = JSON.parse(text); } catch { value = text; } }
    else if (meta.type === 'apps') value = text === 'both' ? 'both' : text.split(',').map(item => item.trim()).filter(Boolean);
    else if (['list', 'checks'].includes(meta.type)) value = text === '' ? [] : text.split(',').map(item => item.trim()).filter(Boolean);
    else value = text;
  }
  return normalizeDecisionValue(key, value);
}
export function normalizeDecisionValue(key, value) {
  const meta = decisionCatalog[key];
  const fail = () => { throw new Error(`${key} 값이 잘못되었습니다: ${JSON.stringify(value)}`); };
  switch (meta.type) {
    case 'boolean': if (typeof value !== 'boolean') fail(); return value;
    case 'string': if (typeof value !== 'string' || !value.trim()) fail(); return value.trim();
    case 'enum': if (!meta.values.includes(value)) fail(); return value;
    case 'apps': {
      const list = value === 'both' ? [...appNames] : Array.isArray(value) ? value : typeof value === 'string' ? [value] : fail();
      if (!list.length || list.some(app => !appNames.includes(app))) fail();
      return appNames.filter(app => list.includes(app));
    }
    case 'list': if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) fail(); return unique(value.map(item => item.trim()));
    case 'checks': {
      if (!Array.isArray(value)) fail();
      return value.map(item => {
        if (typeof item === 'string' && item.trim()) return { name: checkName(item.trim()), command: item.trim() };
        if (item && typeof item.command === 'string' && item.command.trim()) return { name: String(item.name ?? checkName(item.command)).trim() || checkName(item.command), command: item.command.trim() };
        return fail();
      });
    }
    default: return fail();
  }
}
const checkName = command => {
  const script = command.match(/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?([\w:.-]+)/);
  return script ? script[1] : command.split(/\s+/).slice(0, 2).join(' ');
};

// ── compose: 명세 만들기와 계획 ───────────────────────────────────────────────
// request: { app?: 'claude'|'codex'|'both', set?: {키: 값}, force?: boolean, ci?: boolean }. 결과는 결정적이다 — apply가 다시 계산해 비교한다.
export function createCompose(project, request = {}) {
  const root = realpathSync(project);
  const report = diagnose(root);
  const decisions = structuredClone(report.decisions);
  const set = { ...(request.set ?? {}) };
  if (request.app) set.apps = request.app;
  for (const [key, raw] of Object.entries(set)) {
    const value = typeof raw === 'string' ? parseDecisionValue(key, raw) : normalizeDecisionValue(key, raw);
    decisions[key] = decision(value, 'confirmed', '팀 결정 (compose --set)', []);
  }
  if (decisions['protection.allowCommitPush'].value !== true && decisions['protection.blockAttribution'].status === 'pending') {
    decisions['protection.blockAttribution'] = decision(decisions['protection.blockAttribution'].value, 'assumed', '커밋 차단 상태에서는 영향 없음', []);
  }
  // 드리프트는 아래 teamOp에서 다시 판정한다 — 확정한 결정이 손으로 고친 파일과 같은 내용을 만들면 충돌이 아니다.
  const conflicts = report.conflicts.filter(item => !item.id.startsWith('spec.drift.'));
  // 결정으로 해소된 충돌은 뺀다: 지침·설정 충돌은 팀이 답하면 끝난다.
  const resolved = new Set(Object.values(decisions).filter(item => item.status === 'confirmed').map(item => item.conflict).filter(Boolean));
  for (const key of decisionKeys) if (decisions[key].status === 'confirmed' && report.decisions[key]?.conflict) resolved.add(report.decisions[key].conflict);
  const remaining = conflicts.filter(item => !resolved.has(item.id));
  if (decisions['verification.gate'].value === 'rules' && decisions['verification.gate'].status === 'confirmed' && existsSync(join(root, verifierConfigPath)) && !remaining.some(item => item.id === 'gate.config-vs-decision')) {
    remaining.push({ id: 'gate.config-vs-decision', summary: '명세는 종료 검사 훅을 쓰지 않기로 했지만 verifierGate.config.json이 있어 게이트가 계속 동작한다', sources: [verifierConfigPath], resolution: '설정 파일을 지우거나 verification.gate를 stop-hook으로 바꾼다', blocking: true });
  }

  let manifest = null;
  try { manifest = readManifest(root); } catch { manifest = null; }
  const appsValue = decisions.apps.value;
  const appOption = appsValue.length === appNames.length ? 'both' : appsValue[0];
  const history = decisions['records.history'];
  const installedProfile = manifest?.installed ? (manifest.profile ?? 'basic') : null;
  const profile = installedProfile ?? (history.status === 'confirmed' && history.value !== 'none' ? 'basic' : 'minimal');
  const verifier = decisions['verification.gate'].value === 'stop-hook' || manifest?.verifier === true;
  const bundlePlan = createPlan(root, { app: appOption, profile, verifier, ci: request.ci === true });
  const planOps = new Map();
  for (const op of bundlePlan.operations) planOps.set(op.path, op);
  const afterPlan = path => planOps.has(path) ? planOps.get(path).after : readText(root, path);
  const existingSpec = readJson(root, teamSpecPath).data;
  const recorded = existingSpec?.generated && typeof existingSpec.generated === 'object' ? existingSpec.generated : {};

  const teamOps = [];
  const generated = {};
  // 설정 파일별로 그 값을 정하는 결정 키. 이번 요청에서 그 키를 --set으로 확정했으면 손으로 고친 파일을 받아들이거나(같은 값) 덮어쓴다(다른 값).
  const pathKeys = { [branchConfigPath]: ['protection.protectedBranches'], [gitConfigPath]: ['protection.allowCommitPush', 'protection.blockAttribution', 'records.history'], [verifierConfigPath]: ['verification.checks', 'verification.gate'] };
  const teamOp = (path, after, reason) => {
    const disk = readText(root, path);
    const current = generatedHashOf(path, disk);
    const accepted = (pathKeys[path] ?? []).some(key => key in set);
    const drifted = recorded[path] != null && current != null && current !== recorded[path] && !accepted;
    const unknownSection = recorded[path] == null && sectionKind(path) && sectionOf(disk, sectionKind(path)) != null && after !== disk;
    if ((drifted || unknownSection) && !request.force) {
      teamOps.push({ path, action: 'conflict', beforeHash: hash(disk), after: disk, reason: drifted ? 'compose 이후 직접 수정됨 · --set으로 명세를 맞추거나 --force로 다시 생성' : '기록에 없는 생성 구간이 있음 · --force로 다시 생성', origin: 'team' });
      return;
    }
    const base = afterPlan(path);
    if (after === base && planOps.has(path)) { generated[path] = generatedHashOf(path, after); return; } // 번들 계획 결과와 같다 — 번들 op만 남긴다
    const action = disk == null ? 'create' : after === disk ? 'unchanged' : 'update';
    generated[path] = generatedHashOf(path, after);
    teamOps.push({ path, action, beforeHash: hash(disk), after, reason, origin: 'team' });
  };

  // 훅 설정값 — 관리 키만 맞추고 나머지 키는 보존한다. 실제 동작이 같으면 파일을 바꾸지 않는다.
  const protectedBranches = decisions['protection.protectedBranches'].value;
  teamOp(branchConfigPath, mergeJson(afterPlan(branchConfigPath), (current, fresh) => {
    const effective = Array.isArray(current.protectedBranches) ? current.protectedBranches : ['main', 'master'];
    if (fresh || JSON.stringify(effective) !== JSON.stringify(protectedBranches)) current.protectedBranches = protectedBranches;
  }), `보호 브랜치 ${protectedBranches.join(', ')} (${statusLabel(decisions['protection.protectedBranches'])})`);
  const allow = decisions['protection.allowCommitPush'].value === true;
  const requireHistory = allow && history.value === 'required';
  teamOp(gitConfigPath, mergeJson(afterPlan(gitConfigPath), (current, fresh) => {
    if (fresh || (current.allowCommitPush === true) !== allow) current.allowCommitPush = allow;
    const effectiveRequire = (current.allowCommitPush === true) && current.requireHistoryDoc !== false;
    if (fresh) current.requireHistoryDoc = requireHistory; // 새 파일은 새 minimal 설치와 같은 형태로 두 키를 명시한다
    else if (allow && effectiveRequire !== requireHistory) current.requireHistoryDoc = requireHistory;
    if (allow && decisions['protection.blockAttribution'].status !== 'assumed' && (fresh || (current.blockAttribution === true) !== (decisions['protection.blockAttribution'].value === true))) current.blockAttribution = decisions['protection.blockAttribution'].value === true;
    // historyBase는 팀이 기준 브랜치를 직접 확정했을 때만 적는다. 훅의 기본 탐색(dev·main·master)을 임의로 좁히지 않는다.
    if (requireHistory && current.historyBase == null && decisions['rules.baseBranch'].status === 'confirmed') current.historyBase = decisions['rules.baseBranch'].value;
  }), `커밋·푸시 ${allow ? '허용' : '차단'}${allow ? `, 기록 게이트 ${requireHistory ? '켬' : '끔'}` : ''} (${statusLabel(decisions['protection.allowCommitPush'])})`);
  if (decisions['verification.gate'].value === 'stop-hook') {
    const checks = decisions['verification.checks'].value;
    if (checks.length) {
      teamOp(verifierConfigPath, mergeJson(afterPlan(verifierConfigPath), current => {
        const wanted = checks.map(check => ({ name: check.name, command: check.command }));
        const currentChecks = Array.isArray(current.checks) ? current.checks.map(check => ({ name: check?.name, command: check?.command })) : null;
        if (JSON.stringify(currentChecks) !== JSON.stringify(wanted)) current.checks = wanted;
        current.maxIterations ??= 10;
        current.stuckAfter ??= 3;
      }), `종료 검사 명령 ${checks.length}개 (${statusLabel(decisions['verification.checks'])})`);
    } else remaining.push({ id: 'gate.no-checks', summary: '종료 검사 훅을 선택했지만 실행할 검증 명령이 없다', sources: [teamSpecPath], resolution: 'verification.checks를 정하거나 verification.gate를 rules로 둔다', blocking: true });
  }
  // 팀 규칙 문서의 생성 구간. 파일이 없으면 번들 계획이 팀 규칙 양식을 만들고 그 뒤에 구간을 붙인다.
  const rulesBase = afterPlan(teamRulesPath) ?? readFileSync(join(bundleRoot, teamRulesAsset), 'utf8');
  teamOp(teamRulesPath, replaceSection(rulesBase, 'policy', renderPolicySection(decisions, { profile })), '팀 정책 생성 구간 (구간 밖은 보존)');
  // 규칙 포인터 — 선택한 앱의 파일에 하네스 절이 없으면 구간을 붙인다. 있으면 그대로.
  for (const app of appsValue) {
    const path = apps[app].pointer;
    const content = afterPlan(path);
    if (content == null || /##\s*하네스/.test(content)) { if (recorded[path] != null && sectionOf(content, 'pointer') != null) generated[path] = generatedHashOf(path, content); continue; }
    teamOp(path, replaceSection(content, 'pointer', renderPointerSection()), '하네스 포인터 구간 추가 (기존 내용 보존)');
  }
  // 명세 파일 — 결정·근거·생성 해시. 환경에 따라 바뀌는 값은 넣지 않는다.
  const spec = { schemaVersion: 1, tool: 'guksu-harness', composedWith: version(), decisions: Object.fromEntries(decisionKeys.map(key => {
    const { value, status, basis, evidence, conflict } = decisions[key];
    return [key, { value, status, basis, evidence, ...(conflict ? { conflict } : {}) }];
  })), generated: Object.fromEntries(Object.entries(generated).filter(([, value]) => value != null).sort(([a], [b]) => a.localeCompare(b))) };
  const specText = json(spec);
  const specBefore = readText(root, teamSpecPath);
  teamOps.push({ path: teamSpecPath, action: specBefore == null ? 'create' : specBefore === specText ? 'unchanged' : 'update', beforeHash: hash(specBefore), after: specText, reason: '팀 구성 명세 (결정·근거·생성 해시)', origin: 'team' });

  // 번들 계획과 팀 작업을 경로별로 합친다. 같은 경로면 팀 결과가 최종 내용이다.
  const operations = [];
  for (const op of bundlePlan.operations) {
    const team = teamOps.find(item => item.path === op.path);
    if (team && team.action !== 'conflict') { operations.push({ ...op, after: team.after, action: op.action === 'unchanged' ? team.action : op.action, reason: `${op.reason} · ${team.reason}`, origin: 'both' }); continue; }
    operations.push({ ...op, origin: 'bundle' });
  }
  for (const team of teamOps) if (!bundlePlan.operations.some(op => op.path === team.path) || team.action === 'conflict') operations.push(team);
  for (const op of operations.filter(op => op.action === 'conflict' && op.origin !== 'team')) remaining.push({ id: `bundle.${op.path}`, summary: `${op.path}: ${op.reason}`, sources: [op.path], resolution: '기존 update 충돌과 같다. 파일을 정리하거나 eject한 뒤 다시 실행한다', blocking: true });
  for (const op of operations.filter(op => op.action === 'conflict' && op.origin === 'team')) remaining.push({ id: `spec.drift.${op.path}`, summary: `${op.path}: ${op.reason}`, sources: [op.path], resolution: 'compose --set으로 명세를 맞추거나 --force로 다시 생성한다', blocking: true });
  const dedup = new Map(); for (const item of remaining) dedup.set(item.id, item);
  const questions = decisionKeys.filter(key => decisions[key].status === 'pending' && decisionCatalog[key].ask !== false).map(key => buildQuestion(key, decisions[key]));
  return { schemaVersion: 1, root, bundleVersion: version(), request: { app: request.app ?? null, set: request.set ?? {}, force: request.force === true, ci: request.ci === true },
    plan: { profile, verifier, app: appOption }, decisions, questions, conflicts: [...dedup.values()], operations };
}
// 기존 파일은 관리 키의 실제 동작이 다를 때만 고치고(형식·다른 키 보존), 새 파일(fresh)은 관리 키를 명시적으로 적는다.
function mergeJson(text, mutate) {
  let current = {};
  if (text != null) { try { current = JSON.parse(text); } catch { current = null; } }
  if (!current || typeof current !== 'object' || Array.isArray(current)) current = {};
  const before = JSON.stringify(current);
  mutate(current, text == null);
  if (text != null && JSON.stringify(current) === before) return text; // 동작이 같으면 형식도 바꾸지 않는다
  return json(current);
}
export function applyCompose(plan) {
  if (plan?.schemaVersion !== 1 || !Array.isArray(plan.operations)) throw new Error('지원하지 않는 계획입니다');
  const current = createCompose(plan.root, plan.request);
  if (JSON.stringify(current) !== JSON.stringify(plan)) throw new Error('미리보기 이후 파일 또는 번들이 바뀌었습니다. 계획을 다시 만드세요');
  const blocking = plan.conflicts.filter(item => item.blocking);
  if (blocking.length) throw new Error(`적용을 막는 충돌 ${blocking.length}건: ${blocking.map(item => item.summary).join(' / ')}. 안내대로 정리한 뒤 다시 실행하세요`);
  const root = realpathSync(plan.root);
  const changes = plan.operations.filter(op => op.action !== 'conflict' && hash(op.after) !== op.beforeHash)
    .map(op => ({ path: op.path, before: readText(root, op.path), after: op.after }));
  return commitChanges(root, changes);
}

// ── verify: 작동 확인 ─────────────────────────────────────────────────────────
// 네 상태: configured(설정 완료) · verified(실행 확인) · unverified(확인 필요) · failed(실패).
// 정적 파일 검사, 훅 스크립트 시험(임시 저장소·가짜 명령), 검증 명령 실행(run), 앱 안 실행(항상 확인 필요)은 서로 다른 증거다.
export async function verify(project, { run = false } = {}) {
  const root = realpathSync(project);
  const items = [];
  const item = (state, area, subject, detail, extra = {}) => items.push({ state, label: STATES[state], area, subject, detail, ...extra });
  const spec = readJson(root, teamSpecPath).data;
  const decisions = spec?.decisions ?? null;
  let manifest = null;
  try { manifest = readManifest(root); } catch { manifest = null; }
  const targetApps = decisions?.apps?.value ?? manifest?.apps ?? detectApps(root);

  // 1. 정적: 훅 파일·등록·구조 검사·명세 일치.
  const bundleHook = name => readFileSync(join(bundleRoot, `skills/harness/assets/hooks/${name}.mjs`), 'utf8');
  const hookNames = ['blockGitMutation', 'blockSecretAccess', 'branchGuard', ...(existsSync(join(root, hookPath('verifierGate'))) ? ['verifierGate'] : [])];
  const registries = Object.fromEntries(appNames.map(app => [app, readJson(root, apps[app].registry).data]));
  for (const name of hookNames) {
    const content = readText(root, hookPath(name));
    if (content == null) { item('failed', '변경 보호', `${name} 훅 파일`, `${hookPath(name)}이(가) 없다. compose 또는 update로 설치한다`); continue; }
    const ejected = manifest?.ejected?.includes(hookPath(name));
    item('configured', '변경 보호', `${name} 훅 파일`, content === bundleHook(name) ? '번들과 같은 내용' : ejected ? '프로젝트 소유(eject)' : '번들과 다름 — 수정 여부를 확인한다');
    for (const app of targetApps) {
      const event = name === 'verifierGate' ? 'Stop' : 'PreToolUse';
      const entries = registries[app]?.hooks?.[event] ?? [];
      const registered = Array.isArray(entries) && entries.some(entry => entry?.hooks?.some(hook => typeof hook.command === 'string' && hook.command.includes(`/hooks/${name}.mjs`)));
      item(registered ? 'configured' : 'failed', '변경 보호', `${name} ${app} 등록`, registered ? `${apps[app].registry}에 ${event} 등록 있음` : `${apps[app].registry}에 ${event} 등록이 없다`);
    }
  }
  const issues = await validateHarness({ rootDir: root });
  const errors = issues.filter(issue => issue.level === 'error');
  item(errors.length ? 'failed' : 'configured', '작업 규칙', '구조 검사', errors.length ? `error ${errors.length}건: ${errors.map(issue => issue.message).join(' / ')}` : `error 0건, warn ${issues.length}건`);
  if (spec?.generated) {
    for (const [path, recorded] of Object.entries(spec.generated)) {
      const current = generatedHash(root, path);
      if (current == null) item('failed', '작업 규칙', `${path} 생성 구간`, '파일 또는 생성 구간이 없다. compose로 다시 만든다');
      else item(current === recorded ? 'configured' : 'failed', '작업 규칙', path, current === recorded ? '명세와 일치' : 'compose 이후 직접 수정됨 — 명세와 다르다. compose --set으로 맞추거나 --force로 다시 생성한다');
    }
    const pointers = targetApps.map(app => apps[app].pointer);
    for (const path of pointers) {
      const content = readText(root, path);
      item(content != null && /##\s*하네스/.test(content) ? 'configured' : 'failed', '작업 규칙', `${path} 포인터`, content == null ? '파일이 없다' : /##\s*하네스/.test(content) ? '하네스 절이 있다' : '하네스 절이 없다');
    }
  } else item('unverified', '작업 규칙', '팀 구성 명세', `${teamSpecPath}이(가) 없다. compose로 구성하면 설정과 명세의 일치를 비교한다`);

  // 2. 훅 스크립트 시험 — 설치된 훅 파일을 임시 저장소(가짜 .git/HEAD)와 가짜 명령으로 실행한다. 실제 설정 파일을 그대로 읽는다.
  const branchConfig = readJson(root, branchConfigPath).data;
  const protectedBranches = Array.isArray(branchConfig?.protectedBranches) && branchConfig.protectedBranches.length ? branchConfig.protectedBranches : ['main', 'master'];
  const gitConfig = readJson(root, gitConfigPath).data ?? {};
  const allow = gitConfig.allowCommitPush === true;
  const temp = mkdtempSync(join(tmpdir(), 'harness-verify-'));
  try {
    mkdirSync(join(temp, '.git'), { recursive: true });
    const onBranch = branch => writeFileSync(join(temp, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
    const runHook = (name, payload) => {
      const path = join(root, hookPath(name));
      if (!existsSync(path)) return null;
      const env = { ...process.env }; delete env.CLAUDE_PROJECT_DIR;
      const result = spawnSync(process.execPath, [path], { input: JSON.stringify({ session_id: 'verify', cwd: temp, ...payload }), encoding: 'utf8', env, timeout: 20000 });
      return { status: result.status, stderr: (result.stderr ?? '').trim() };
    };
    const expect = (area, subject, result, expectedStatus, detail) => {
      if (result == null) return;
      const ok = result.status === expectedStatus;
      const firstSentence = result.stderr ? result.stderr.split('\n')[0].split(/(?<=[.!])\s/)[0].slice(0, 90) : '';
      item(ok ? 'verified' : 'failed', area, subject, `${detail} → exit ${result.status}${ok ? ' (기대와 같음)' : ` (기대 ${expectedStatus})`}${firstSentence ? ` · ${firstSentence}` : ''}`, { evidence: '임시 저장소 · 가짜 명령' });
    };
    onBranch(protectedBranches[0]);
    expect('변경 보호', 'branchGuard 스크립트 — 보호 브랜치 편집', runHook('branchGuard', { tool_name: 'Edit', tool_input: { file_path: 'src/app.js' } }), 2, `${protectedBranches[0]} 위에서 Edit`);
    onBranch('feat/verify-check');
    expect('변경 보호', 'branchGuard 스크립트 — 작업 브랜치 편집', runHook('branchGuard', { tool_name: 'Edit', tool_input: { file_path: 'src/app.js' } }), 0, 'feat/verify-check 위에서 Edit');
    expect('변경 보호', `blockGitMutation 스크립트 — 커밋 (${allow ? '허용 설정' : '차단 설정'})`, runHook('blockGitMutation', { tool_name: 'Bash', tool_input: { command: 'git commit -m "verify"' } }), allow ? 0 : 2, 'git commit -m');
    expect('변경 보호', 'blockGitMutation 스크립트 — force push', runHook('blockGitMutation', { tool_name: 'Bash', tool_input: { command: 'git push --force origin main' } }), 2, 'git push --force');
    expect('변경 보호', 'blockGitMutation 스크립트 — rebase', runHook('blockGitMutation', { tool_name: 'Bash', tool_input: { command: 'git rebase main' } }), 2, 'git rebase');
    expect('변경 보호', 'blockSecretAccess 스크립트 — .env 읽기', runHook('blockSecretAccess', { tool_name: 'Bash', tool_input: { command: 'cat .env' } }), 2, 'cat .env (가짜 경로)');
    expect('변경 보호', 'blockSecretAccess 스크립트 — 예시 파일', runHook('blockSecretAccess', { tool_name: 'Bash', tool_input: { command: 'cat .env.example' } }), 0, 'cat .env.example');
    if (allow && gitConfig.requireHistoryDoc !== false) item('unverified', '기록·인계', '기록 게이트(requireHistoryDoc)', '임시 저장소에는 비교할 기준 브랜치가 없어 판정할 수 없다. 실제 저장소의 작업 브랜치에서 기록 없는 push가 차단되는지 확인한다');
  } finally { rmSync(temp, { recursive: true, force: true }); }
  if (hookNames.includes('verifierGate')) item('unverified', '검증', 'verifierGate 스크립트', existsSync(join(root, verifierConfigPath)) ? 'Stop 이벤트에서만 동작한다. 앱에서 검증 실패 상태로 턴을 끝내 차단 메시지가 나오는지 확인한다' : '설정 파일이 없어 비활성이다');

  // 3. 검증 명령 — run일 때만 실행한다. 아니면 확인 필요.
  const checks = decisions?.['verification.checks']?.value ?? [];
  if (!checks.length) item('unverified', '검증', '검증 명령', '명세에 검증 명령이 없다. 팀이 명령을 정하면 compose --set verification.checks=... 로 연결한다');
  for (const check of checks) {
    if (!run) { item('unverified', '검증', `검증 명령 ${check.command}`, 'verify --run으로 실행하거나 팀이 직접 실행해 결과를 확인한다'); continue; }
    const started = Date.now();
    try {
      execSync(check.command, { cwd: root, stdio: 'pipe', timeout: 300000, encoding: 'utf8' });
      item('verified', '검증', `검증 명령 ${check.command}`, `exit 0 · ${Date.now() - started}ms`, { evidence: '프로젝트에서 실제 실행' });
    } catch (error) {
      const output = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim().split('\n').slice(-5).join('\n').slice(0, 600);
      item('failed', '검증', `검증 명령 ${check.command}`, `exit ${error.status ?? '?'}${error.signal ? ` (${error.signal})` : ''}${output ? `\n${output}` : ''}`, { evidence: '프로젝트에서 실제 실행' });
    }
  }

  // 4. 앱 안 실행 — 이 도구는 확인할 수 없다. 절차만 준다.
  for (const app of targetApps) {
    const steps = app === 'claude'
      ? 'Claude Code에서 프로젝트를 열고 ① 보호 브랜치에서 파일 편집 요청 → "보호 브랜치" 차단 메시지, ② `git commit -m test` 요청 → 설정에 맞는 차단·허용, ③ `cat .env` 요청 → "시크릿 파일" 차단 메시지를 확인한다'
      : 'Codex에서 ~/.codex/config.toml의 hooks 기능이 켜져 있고 프로젝트를 신뢰했는지 확인한 뒤 ① 보호 브랜치에서 편집 요청, ② `git commit -m test` 요청, ③ `cat .env` 요청의 차단 메시지를 확인한다. 편집 차단이 적용되지 않는 버전 보고(openai/codex #27833)가 있어 실제 버전에서 확인이 필요하다';
    item('unverified', '변경 보호', `${app} 앱 안에서 훅 실행`, `등록 파일만으로는 실행을 증명할 수 없다. ${steps}`);
  }
  const pending = decisions ? decisionKeys.filter(key => decisions[key]?.status === 'pending' && decisionCatalog[key].ask !== false) : [];
  const summary = Object.fromEntries(Object.keys(STATES).map(state => [state, items.filter(entry => entry.state === state).length]));
  return { schemaVersion: 1, root, bundleVersion: version(), run, items, summary, pending, ok: summary.failed === 0 };
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, project = '.'] = process.argv.slice(2);
  try {
    if (command === 'diagnose') console.log(json(diagnose(project)));
    else if (command === 'verify') console.log(json(await verify(project, { run: process.argv.includes('--run') })));
    else throw new Error('사용법: teamCompose.mjs diagnose|verify <프로젝트> [--run]. compose는 npx guksu-harness compose를 쓴다');
  } catch (error) { console.error(`실패: ${error.message}`); process.exitCode = 1; }
}
