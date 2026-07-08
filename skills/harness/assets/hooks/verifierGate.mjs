#!/usr/bin/env node
// Stop 훅 — 검증자 게이트: 종료 규칙(검증 명령 전체 통과)을 충족하지 못하면 턴 종료를 차단한다.
// 안전장치(토큰 예산·최대 반복)에 도달하면 반대로 루프를 계속하지 않고 "보고 후 종료"를 지시한다.
// 설정 파일(스크립트 옆 verifierGate.config.json):
//   {
//     "checks": [{ "name": "test", "command": "npm test" }],
//     "maxIterations": 10,
//     "maxTokens": 500000,
//     "stuckAfter": 3
//   }
// 설정 파일이 없으면 게이트는 비활성(무해)이다.
// stuckAfter: 같은 실패 시그니처가 N연속이면 반복을 계속하지 않고 보고 후 종료(막힘 판정).
//   루프 명세(docs/loops/)의 "막힘 판정"과 게이트를 일치시키는 수단이다. 생략하면 비활성.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// transcript JSONL의 누적 토큰 사용량(입력+출력+캐시 생성)을 합산한다.
export const sumTranscriptTokens = (jsonl) => {
  let total = 0;
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    try {
      const usage = JSON.parse(line)?.message?.usage;
      if (usage) {
        total +=
          (usage.input_tokens ?? 0) +
          (usage.output_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0);
      }
    } catch {
      // 손상된 줄은 건너뛴다 — 토큰 집계는 근사치여도 안전장치로 충분하다
    }
  }
  return total;
};

// 검증 명령을 전부 실행하고 실패만 수집한다 (전부 실행해야 실패 전체가 피드백된다).
export const runChecks = ({ checks, cwd }) => {
  const failures = [];
  for (const check of checks) {
    try {
      execSync(check.command, { stdio: 'pipe', timeout: 300000, cwd });
    } catch (error) {
      failures.push({
        name: check.name,
        output: `${error.stdout ?? ''}${error.stderr ?? ''}`.slice(0, 2000),
      });
    }
  }
  return failures;
};

// 실패 시그니처 — "같은 에러가 반복되는가"를 판정하는 지문. 실패한 검증 이름 + 출력의
// 첫 비어있지 않은 줄(정규화)로 만든다. 출력 전체를 쓰면 타임스탬프·경로 등 매번 바뀌는
// 값 때문에 같은 에러도 다른 시그니처가 되어 막힘을 놓친다.
export const failureSignature = (failures) =>
  failures
    .map((failure) => {
      const firstLine =
        (failure.output ?? '')
          .split('\n')
          .map((line) => line.trim())
          .find((line) => line.length > 0) ?? '';
      // 숫자(줄 번호·소요 시간·카운트)를 지워 사소한 변동에 시그니처가 흔들리지 않게 한다
      return `${failure.name}:${firstLine.replace(/\d+/g, '#')}`;
    })
    .sort()
    .join('|');

// 판정 순서가 규칙이다: (1) 검증 전체 통과 = 성공 종료 허용(예산과 무관 — 수렴했다),
// (2) 실패가 남았는데 안전장치 도달(예산·반복·막힘) = 계속하지 않고 보고 후 종료 지시,
// (3) 실패 + 여력 있음 = 차단하고 계속.
// sameFailureStreak: 현재 실패 시그니처가 직전까지 연속으로 몇 번 나왔는가(현재 포함).
export const decide = ({ config, iterations, tokensUsed, failures, sameFailureStreak = 1 }) => {
  if (failures.length === 0) return { action: 'allow' };

  const overTokens = config.maxTokens != null && tokensUsed >= config.maxTokens;
  const overIterations = config.maxIterations != null && iterations >= config.maxIterations;
  const stuck = config.stuckAfter != null && sameFailureStreak >= config.stuckAfter;
  if (overTokens || overIterations || stuck) {
    const cause = overTokens
      ? `토큰 예산 초과(${tokensUsed}/${config.maxTokens})`
      : overIterations
        ? `최대 반복 도달(${iterations}/${config.maxIterations})`
        : `막힘 판정 — 같은 실패 ${sameFailureStreak}연속(임계 ${config.stuckAfter})`;
    return {
      action: 'wrapup',
      reason: `안전장치 도달 — ${cause}. 루프를 계속하지 말 것. 지금까지의 진행 상황, 남은 검증 실패(${failures
        .map((failure) => failure.name)
        .join(', ')}), 중단 사유를 사용자에게 보고하고 종료하라. 보고 후 종료는 차단되지 않는다.`,
    };
  }

  return {
    action: 'block',
    reason: `종료 규칙 미충족 — 실패한 검증:\n${failures
      .map((failure) => `[${failure.name}]\n${failure.output}`)
      .join('\n')}`,
  };
};

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (input.stop_hook_active) process.exit(0); // 무한 차단 루프 방지 가드 — 삭제 금지

  const hookDir = dirname(fileURLToPath(import.meta.url));
  const configPath = join(hookDir, 'verifierGate.config.json');
  if (!existsSync(configPath)) process.exit(0); // 미구성 — 게이트 비활성

  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  let tokensUsed = 0;
  if (config.maxTokens != null && input.transcript_path && existsSync(input.transcript_path)) {
    tokensUsed = sumTranscriptTokens(readFileSync(input.transcript_path, 'utf8'));
  }

  const statePath = join(hookDir, 'verifierGate.state.json');
  const rawState = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
  // 이전 스키마(값이 숫자)와의 호환: 세션별 상태를 {iterations, signature, streak} 객체로 정규화.
  const prior = rawState[input.session_id];
  const sessionState =
    typeof prior === 'number' ? { iterations: prior, signature: null, streak: 0 } : prior ?? {};
  const iterations = sessionState.iterations ?? 0;

  const failures = runChecks({ checks: config.checks ?? [], cwd: input.cwd });
  const signature = failureSignature(failures);
  const sameFailureStreak =
    failures.length > 0 && signature === sessionState.signature
      ? (sessionState.streak ?? 1) + 1
      : 1;

  const decision = decide({ config, iterations, tokensUsed, failures, sameFailureStreak });
  if (decision.action === 'allow') {
    // 수렴 성공 — 세션 상태를 정리해 다음 루프가 깨끗하게 시작하게 한다
    delete rawState[input.session_id];
    writeFileSync(statePath, JSON.stringify(rawState));
    process.exit(0);
  }

  rawState[input.session_id] = { iterations: iterations + 1, signature, streak: sameFailureStreak };
  writeFileSync(statePath, JSON.stringify(rawState));
  console.error(decision.reason);
  process.exit(2);
}
