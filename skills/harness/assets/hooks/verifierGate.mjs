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

// 실패 시그니처 — "같은 에러가 반복되는가"를 판정하는 지문. 실패한 검증 이름 + 출력 전체를
// 정규화(숫자→#, 공백 압축)해 만든다. 첫 줄만 쓰면 안 된다 — npm의 "> pkg@1.0.0 test" 배너처럼
// 고정된 첫 줄이 모든 실패를 동일 시그니처로 만들어, 수렴 중인 루프를 막힘으로 오판한다.
// 전체 출력이어야 실패한 테스트 목록의 변화(= 진전)가 시그니처 변화로 감지된다.
// 숫자 정규화는 줄 번호·소요 시간 변동에 시그니처가 흔들리지 않게 하기 위함이다.
export const failureSignature = (failures) =>
  failures
    .map(
      (failure) =>
        `${failure.name}:${(failure.output ?? '')
          .replace(/\d+/g, '#')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 500)}`,
    )
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
  const readState = () => {
    try {
      return existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
    } catch {
      return {}; // 손상된 상태 파일은 초기화 — 안전장치 카운터는 근사치여도 충분하다
    }
  };
  // 자기 세션 키만 갱신하되 쓰기 직전에 파일을 다시 읽는다 — 상태 파일은 session_id 키로
  // 동시 세션을 전제하므로, 훅 시작 시점 스냅숏을 그대로 되쓰면 그 사이 다른 세션이 올린
  // 카운터를 낡은 값으로 되감는다(완전한 락은 아니지만 경쟁 창을 훅 실행 시간 → 쓰기
  // 직전으로 좁힌다).
  const writeSessionState = (value) => {
    const fresh = readState();
    fresh[input.session_id] = value;
    writeFileSync(statePath, JSON.stringify(fresh));
  };
  // 이전 스키마(값이 숫자)와의 호환: 세션별 상태를 {iterations, signature, streak} 객체로 정규화.
  const prior = readState()[input.session_id];
  const sessionState = typeof prior === 'number' ? { iterations: prior } : prior ?? {};
  const iterations = sessionState.iterations ?? 0;

  const failures = runChecks({ checks: config.checks ?? [], cwd: input.cwd });
  const signature = failureSignature(failures);
  const sameFailureStreak =
    failures.length > 0 && signature === sessionState.signature
      ? (sessionState.streak ?? 0) + 1
      : 1;

  const decision = decide({ config, iterations, tokensUsed, failures, sameFailureStreak });
  if (decision.action === 'allow') {
    // iterations는 문서화된 의미(세션별 누적 차단 횟수)라 통과했다고 리셋하지 않는다 —
    // 리셋하면 flaky 체크가 한 번 통과할 때마다 maxIterations가 초기화되어 세션당 총
    // 차단 횟수를 상한하지 못한다. 막힘 추적(signature/streak)만 통과 시점에 끊는다.
    if (sessionState.signature != null || (sessionState.streak ?? 0) !== 0) {
      writeSessionState({ iterations, signature: null, streak: 0 });
    }
    process.exit(0);
  }

  writeSessionState({ iterations: iterations + 1, signature, streak: sameFailureStreak });
  console.error(decision.reason);
  process.exit(2);
}
