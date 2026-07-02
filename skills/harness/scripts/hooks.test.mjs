import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isGitMutation } from '../assets/hooks/blockGitMutation.mjs';
import { referencesSecret } from '../assets/hooks/blockSecretAccess.mjs';

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
