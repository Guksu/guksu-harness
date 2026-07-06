import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isGitMutation } from '../assets/hooks/blockGitMutation.mjs';
import { referencesSecret } from '../assets/hooks/blockSecretAccess.mjs';
import { decide, runChecks, sumTranscriptTokens } from '../assets/hooks/verifierGate.mjs';

test('git 변경 명령을 차단한다', () => {
  const blocked = [
    'git commit -m "x"',
    'git push origin main',
    'git -C /tmp/repo commit -m x', // 값을 별도 인자로 받는 -C 플래그 우회
    'git -c user.name=x push',
    'git --git-dir .git push',
    'git --git-dir=.git push',
    'git checkout -b feature',
    'git branch -D old',
    'git stash',
    'git worktree add ../wt',
    'cd repo && git rebase main',
  ];
  for (const command of blocked) {
    assert.ok(isGitMutation(command), `차단되어야 한다: ${command}`);
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
