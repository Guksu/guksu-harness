import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isGitMutation } from '../assets/hooks/blockGitMutation.mjs';
import { referencesSecret } from '../assets/hooks/blockSecretAccess.mjs';
import {
  decide,
  failureSignature,
  runChecks,
  sumTranscriptTokens,
} from '../assets/hooks/verifierGate.mjs';
import {
  DEFAULT_PROTECTED_BRANCHES,
  isProtectedBranch,
  readCurrentBranch,
} from '../assets/hooks/branchGuard.mjs';

test('git 변경 명령을 차단한다', () => {
  const blocked = [
    'git commit -m "x"',
    'git push origin main',
    'git -C /tmp/repo commit -m x', // 값을 별도 인자로 받는 -C 플래그 우회
    'git -c user.name=x push',
    'git --git-dir .git push',
    'git --git-dir=.git push',
    'git checkout -b feature',
    'git checkout main',
    'git branch -D old',
    'git stash',
    'git worktree add ../wt',
    'cd repo && git rebase main',
  ];
  for (const command of blocked) {
    assert.ok(isGitMutation(command), `차단되어야 한다: ${command}`);
  }
});

test('git switch — 순수 브랜치 전환은 허용, 파괴 플래그는 차단한다', () => {
  const allowed = [
    'git switch -c feature/login',
    'git switch feature/login',
    'git switch -',
    'git -C /tmp/repo switch -c fix/bug',
    'git switch -m feature/login', // 3-way 머지 전환은 안전
    'git switch main\nls -f', // 멀티라인 — 다음 줄의 -f는 switch 인자가 아니다
  ];
  for (const command of allowed) {
    assert.ok(!isGitMutation(command), `허용되어야 한다: ${JSON.stringify(command)}`);
  }
  const blocked = [
    'git switch -f main',
    'git switch --force main',
    'git switch --discard-changes main',
    'git switch -C feature', // 기존 브랜치 강제 리셋
    'git switch --force-create feature',
    'git switch -fc topic', // 번들 단축 옵션 (-f + -c)
    'git switch -Cmain', // 값 붙임꼴 (-C main)
    'git switch "-f" main', // 셸이 따옴표를 벗겨 전달한다
    'git switch --orphan scratch', // 워킹트리의 추적 파일 전부 제거
    'git switch --detach main', // detached HEAD — branchGuard 무력화
    'git switch -d main',
    'git switch -c a && git switch -f main', // 두 번째 switch도 검사한다
  ];
  for (const command of blocked) {
    assert.ok(isGitMutation(command), `차단되어야 한다: ${JSON.stringify(command)}`);
  }
});

test('git 읽기 명령은 허용한다', () => {
  const allowed = [
    'git status -sb',
    'git -C /tmp/repo status',
    'git log --oneline -5',
    'git diff HEAD',
    'git show abc123',
    'git blame src/index.ts',
    'git branch --list',
    'npm test',
  ];
  for (const command of allowed) {
    assert.ok(!isGitMutation(command), `허용되어야 한다: ${command}`);
  }
});

test('시크릿 파일 접근을 차단한다', () => {
  const blocked = [
    'cat .env',
    'cat ./apps/web/.env.local',
    'grep API_KEY .env',
    'less config/credentials.json',
    'openssl rsa -in server.pem',
    'cat secrets/db-password.txt',
    'KEY=$(cat .env) node run.js',
    'node --env-file=.env server.js',
  ];
  for (const command of blocked) {
    assert.ok(referencesSecret(command), `차단되어야 한다: ${command}`);
  }
});

test('시크릿이 아닌 명령은 허용한다', () => {
  const allowed = [
    'cp .env.example .env.example.bak',
    'cat .env.sample',
    'npm install dotenv',
    'node -r dotenv/config app.js',
    'cat README.md',
    'ls src/environments',
  ];
  for (const command of allowed) {
    assert.ok(!referencesSecret(command), `허용되어야 한다: ${command}`);
  }
});

test('브랜치 가드 — .git/HEAD에서 현재 브랜치를 읽는다', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'guksu-branch-'));
  await mkdir(join(rootDir, '.git'), { recursive: true });
  await writeFile(join(rootDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  assert.equal(readCurrentBranch({ projectDir: rootDir }), 'main');

  await writeFile(join(rootDir, '.git', 'HEAD'), 'ref: refs/heads/feature/login\n');
  assert.equal(readCurrentBranch({ projectDir: rootDir }), 'feature/login');
  await rm(rootDir, { recursive: true, force: true });
});

test('브랜치 가드 — worktree(.git 파일)의 gitdir 포인터를 따라간다', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'guksu-branch-'));
  const gitDir = join(rootDir, 'gitdirs', 'wt1');
  const workTree = join(rootDir, 'wt');
  await mkdir(gitDir, { recursive: true });
  await mkdir(workTree, { recursive: true });
  await writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/develop\n');
  await writeFile(join(workTree, '.git'), `gitdir: ${gitDir}\n`);
  assert.equal(readCurrentBranch({ projectDir: workTree }), 'develop');
  await rm(rootDir, { recursive: true, force: true });
});

test('브랜치 가드 — detached HEAD·git 저장소 아님은 null (가드 비활성)', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'guksu-branch-'));
  assert.equal(readCurrentBranch({ projectDir: rootDir }), null); // .git 없음
  await mkdir(join(rootDir, '.git'), { recursive: true });
  await writeFile(join(rootDir, '.git', 'HEAD'), 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2\n');
  assert.equal(readCurrentBranch({ projectDir: rootDir }), null); // detached
  await rm(rootDir, { recursive: true, force: true });
});

// CLI 경로 검증 — config는 스크립트 옆에서 읽으므로 훅을 임시 디렉토리로 복사해 실행한다
const runBranchGuardCli = async ({ config, headRef }) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'guksu-guard-cli-'));
  const hookPath = join(rootDir, 'branchGuard.mjs');
  await copyFile(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'hooks', 'branchGuard.mjs'),
    hookPath,
  );
  if (config != null) await writeFile(join(rootDir, 'branchGuard.config.json'), config);
  const projectDir = join(rootDir, 'project');
  await mkdir(join(projectDir, '.git'), { recursive: true });
  await writeFile(join(projectDir, '.git', 'HEAD'), headRef);
  const result = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify({ cwd: projectDir, tool_input: { file_path: 'a.ts' } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    encoding: 'utf8',
  });
  await rm(rootDir, { recursive: true, force: true });
  return result;
};

test('브랜치 가드 CLI — 보호 브랜치 편집은 exit 2로 차단, 작업 브랜치는 통과', async () => {
  const onMain = await runBranchGuardCli({ headRef: 'ref: refs/heads/main\n' });
  assert.equal(onMain.status, 2);
  assert.ok(onMain.stderr.includes('보호 브랜치'));

  const onFeature = await runBranchGuardCli({ headRef: 'ref: refs/heads/feat/login\n' });
  assert.equal(onFeature.status, 0);
});

test('브랜치 가드 CLI — 설정 파일이 깨져 있으면 fail-closed(차단)한다', async () => {
  const badConfig = await runBranchGuardCli({
    headRef: 'ref: refs/heads/feat/login\n', // 작업 브랜치인데도
    config: '{ "protectedBranches": ["main",] }', // 트레일링 콤마 — 파싱 실패
  });
  assert.equal(badConfig.status, 2, '설정 오류는 조용한 fail-open이 아니라 차단이어야 한다');
  assert.ok(badConfig.stderr.includes('파싱 실패'));
});

test('브랜치 가드 — 보호 브랜치 판정 (기본 main·master)', () => {
  assert.ok(isProtectedBranch({ branch: 'main', protectedBranches: DEFAULT_PROTECTED_BRANCHES }));
  assert.ok(isProtectedBranch({ branch: 'master', protectedBranches: DEFAULT_PROTECTED_BRANCHES }));
  assert.ok(
    !isProtectedBranch({ branch: 'feature/login', protectedBranches: DEFAULT_PROTECTED_BRANCHES }),
  );
  assert.ok(!isProtectedBranch({ branch: null, protectedBranches: DEFAULT_PROTECTED_BRANCHES }));
  assert.ok(isProtectedBranch({ branch: 'develop', protectedBranches: ['develop'] }));
});

test('검증자 게이트 — 검증 전체 통과면 종료를 허용한다', () => {
  const decision = decide({
    config: { maxIterations: 10, maxTokens: 1000 },
    iterations: 3,
    tokensUsed: 900,
    failures: [],
  });
  assert.equal(decision.action, 'allow');
});

test('검증자 게이트 — 검증 실패면 종료를 차단하고 실패를 피드백한다', () => {
  const decision = decide({
    config: { maxIterations: 10 },
    iterations: 1,
    tokensUsed: 0,
    failures: [{ name: 'test', output: '1 failed' }],
  });
  assert.equal(decision.action, 'block');
  assert.ok(decision.reason.includes('test'));
  assert.ok(decision.reason.includes('1 failed'));
});

test('검증자 게이트 — 토큰 예산 초과면 루프를 멈추고 보고 후 종료를 지시한다', () => {
  const decision = decide({
    config: { maxTokens: 1000 },
    iterations: 0,
    tokensUsed: 1500,
    failures: [{ name: 'test', output: 'fail' }],
  });
  assert.equal(decision.action, 'wrapup');
  assert.ok(decision.reason.includes('토큰 예산 초과'));
  assert.ok(decision.reason.includes('보고'));
});

test('검증자 게이트 — 최대 반복 도달이면 보고 후 종료를 지시한다', () => {
  const decision = decide({
    config: { maxIterations: 5 },
    iterations: 5,
    tokensUsed: 0,
    failures: [{ name: 'lint', output: 'fail' }],
  });
  assert.equal(decision.action, 'wrapup');
  assert.ok(decision.reason.includes('최대 반복'));
});

test('검증자 게이트 — 같은 실패 N연속(stuckAfter)이면 막힘으로 보고 후 종료', () => {
  const stuck = decide({
    config: { stuckAfter: 3, maxIterations: 100 },
    iterations: 4,
    tokensUsed: 0,
    failures: [{ name: 'test', output: 'AssertionError' }],
    sameFailureStreak: 3,
  });
  assert.equal(stuck.action, 'wrapup');
  assert.ok(stuck.reason.includes('막힘'));

  // 아직 임계 미만이면 계속 차단한다
  const notYet = decide({
    config: { stuckAfter: 3, maxIterations: 100 },
    iterations: 2,
    tokensUsed: 0,
    failures: [{ name: 'test', output: 'AssertionError' }],
    sameFailureStreak: 2,
  });
  assert.equal(notYet.action, 'block');
});

test('실패 시그니처 — 출력 전체 기준: 숫자 변동은 무시, 내용 변화(진전)는 감지한다', () => {
  // 같은 에러가 줄 번호·소요 시간만 바뀌어 반복 → 같은 시그니처 (막힘 감지)
  const a = failureSignature([{ name: 'test', output: 'FAIL at line 42\n  expect(a).toBe(b)' }]);
  const b = failureSignature([{ name: 'test', output: 'FAIL at line 99\n  expect(a).toBe(b)' }]);
  assert.equal(a, b, '숫자만 다른 같은 에러는 같은 시그니처');

  // 실패한 테스트 목록이 바뀜(수렴 중) → 다른 시그니처 — 첫 줄(npm 배너)이 같아도 구분해야 한다
  const banner1 = failureSignature([
    { name: 'test', output: '> pkg@1.0.0 test\nFAIL auth.test.ts\nFAIL cart.test.ts' },
  ]);
  const banner2 = failureSignature([
    { name: 'test', output: '> pkg@1.0.0 test\nFAIL cart.test.ts' },
  ]);
  assert.notEqual(banner1, banner2, '배너가 같아도 실패 목록이 다르면 다른 시그니처');

  const c = failureSignature([{ name: 'test', output: 'TypeError: x is undefined' }]);
  assert.notEqual(a, c, '다른 에러는 다른 시그니처');

  // 실패 순서가 달라도 정렬되어 같은 시그니처
  const twoAB = failureSignature([
    { name: 'test', output: 'X' },
    { name: 'lint', output: 'Y' },
  ]);
  const twoBA = failureSignature([
    { name: 'lint', output: 'Y' },
    { name: 'test', output: 'X' },
  ]);
  assert.equal(twoAB, twoBA);
});

test('검증자 게이트 — transcript 토큰 사용량을 합산한다 (손상 줄은 무시)', () => {
  const jsonl = [
    JSON.stringify({ message: { usage: { input_tokens: 100, output_tokens: 50 } } }),
    'not-json-line',
    JSON.stringify({ type: 'user', message: { content: 'no usage' } }),
    JSON.stringify({
      message: { usage: { input_tokens: 200, output_tokens: 25, cache_creation_input_tokens: 10 } },
    }),
  ].join('\n');
  assert.equal(sumTranscriptTokens(jsonl), 385);
});

test('검증자 게이트 — 검증 명령을 전부 실행해 실패만 수집한다', () => {
  const failures = runChecks({
    checks: [
      { name: 'pass', command: 'node -e "process.exit(0)"' },
      { name: 'fail', command: 'node -e "console.error(42); process.exit(1)"' },
    ],
  });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].name, 'fail');
  assert.ok(failures[0].output.includes('42'));
});
