#!/usr/bin/env node
// Stop 훅 — 검증자 게이트: 종료 규칙(검증 명령 전체 통과)을 충족하지 못하면 턴 종료를 차단한다.
// 안전장치(토큰 예산·최대 반복)에 도달하면 반대로 루프를 계속하지 않고 "보고 후 종료"를 지시한다.
// 설정 파일(스크립트 옆 verifierGate.config.json):
//   {
//     "checks": [{ "name": "test", "command": "npm test" }],
//     "maxIterations": 10,
//     "maxTokens": 20000000,
//     "stuckAfter": 3
//   }
// 설정 파일이 없으면 게이트는 비활성(무해)이다.
// Claude Code·Codex 모두 Stop 입력에 session_id·cwd·stop_hook_active·transcript_path를 같은 이름으로 준다.
//   transcript 파일 형식이 다른 앱에서는 maxTokens 합산이 0이 될 수 있다 — 그 경우 예산 검사는 동작하지 않는다.
// maxTokens는 세션 transcript 누적 합계 기준이다(루프 1회분 예산이 아니다) — 매 턴의 input_tokens에
//   대화 전체가 다시 들어가므로 세션이 길수록 초선형으로 커진다. "이 세션을 여기서 끊는다"는 상한으로
//   잡는다. 작업 1건의 예상 토큰으로 잡으면 정상 작업 중에 매 턴 발동한다.
// stuckAfter: 같은 실패 시그니처가 N연속이면 반복을 계속하지 않고 보고 후 종료(막힘 판정).
//   루프 명세(docs/loops/)의 "막힘 판정"과 게이트를 일치시키는 수단이다. 생략하면 비활성.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync, renameSync } from 'node:fs';
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

// 심링크 경로 호출 시 ESM URL(realpath) ↔ argv[1](원문) 불일치로 fail-open이 되지 않게
// 양쪽을 realpath로 정규화해 비교한다.
const toRealPath = (p) => { try { return realpathSync(p); } catch { return p; } };
const isDirectRun = process.argv[1] != null
  && toRealPath(process.argv[1]) === toRealPath(fileURLToPath(import.meta.url));
if (isDirectRun) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));

  const hookDir = dirname(fileURLToPath(import.meta.url));
  const configPath = join(hookDir, 'verifierGate.config.json');
  if (!existsSync(configPath)) process.exit(0); // 미구성 — 게이트 비활성

  // 세션별 파일 + 원자적 교체로 다른 세션의 상태를 덮어쓰지 않는다.
  const sessionKey = createHash('sha256').update(String(input.session_id ?? 'default')).digest('hex');
  const statePath = join(hookDir, `verifierGate.${sessionKey}.state.json`);
  let sessionState = {};
  try { sessionState = JSON.parse(readFileSync(statePath, 'utf8')); } catch { /* 최초 실행 */ }
  if (!sessionState || typeof sessionState !== 'object' || Array.isArray(sessionState)) sessionState = {};
  const writeSessionState = (value) => {
    const temporary = `${statePath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(value));
    renameSync(temporary, statePath);
  };
  // stop_hook_active 자체는 통과 조건이 아니다. 우리가 중단 보고를 요청한 다음 종료만 허용한다.
  if (input.stop_hook_active && sessionState.wrapup) process.exit(0);

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (!Array.isArray(config.checks) || config.checks.length === 0 ||
        config.checks.some(check => !check || typeof check.name !== 'string' ||
          typeof check.command !== 'string' || !check.command.trim())) {
      throw new Error('checks에 이름과 실행 명령을 한 개 이상 지정하세요');
    }
    config.maxIterations ??= 10;
    for (const field of ['maxIterations', 'maxTokens', 'stuckAfter']) {
      if (config[field] != null && (!Number.isSafeInteger(config[field]) || config[field] <= 0)) {
        throw new Error(`${field}는 양의 정수여야 합니다`);
      }
    }
  } catch (error) {
    writeSessionState({ ...sessionState, wrapup: true });
    console.error(`검증 설정 오류: ${error.message}. 검증하지 못했습니다. 설정 오류를 보고하고 종료하세요.`);
    process.exit(2);
  }

  let tokensUsed = 0;
  if (config.maxTokens != null) {
    try {
      if (!input.transcript_path) throw new Error('transcript 없음');
      tokensUsed = sumTranscriptTokens(readFileSync(input.transcript_path, 'utf8'));
    } catch {
      writeSessionState({ ...sessionState, wrapup: true });
      console.error('토큰 사용량을 확인할 수 없습니다. 예산 보호를 보장할 수 없어 중단합니다. 사유를 보고하고 종료하세요.');
      process.exit(2);
    }
  }
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
    writeSessionState({ iterations, signature: null, streak: 0, wrapup: false });
    process.exit(0);
  }

  writeSessionState({ iterations: iterations + 1, signature, streak: sameFailureStreak, wrapup: decision.action === 'wrapup' });
  console.error(decision.reason);
  process.exit(2);
}
