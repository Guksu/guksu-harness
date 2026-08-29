# 하네스 다이어트 — 기록 체계 통합과 과잉 스킬 제거

| 항목 | 내용 |
|------|------|
| 날짜 | 2026-08-29 |
| 브랜치 | claude/harness-improvement-analysis-mjzm3h |
| PR | 미생성 |
| 관련 경로 | `skills/`, `README.md`, `CHANGELOG.md`, `.claude-plugin/` |

## 1. 개요

과한 하네스를 지양하는 방향으로 하네스를 덜어내고, 남긴 부분을 기계적 강제로 굳혔다. 문제는 기록 층의 과잉 생산이었다 — 기능 1건당 보존 문서가 최대 9개(설계서 + 역할별 산출물 3 + 워크로그 3 + HTML 보고서 + 회고)까지 나왔고, 그중 서로 다른 질문에 답하는 것은 3개뿐이었다. 나머지는 "무엇을 했는가"를 형식만 바꿔 반복했다.

핵심 변경은 **작업 1건당 기록 1개**다. 역할 간에 주고받는 작업 산출물(`_workspace/`, 휘발)과 보존되는 기록(`docs/history/`, PR 단위 1개)을 분리하고, 그 하나를 훅으로 강제했다. 에이전트 구성(기획·구현·QA)은 유지했다 — 생성자와 검증자를 분리하는 것이 역할을 나눌 유일한 필수 근거다.

## 2. 작업 내용

- **`skills/docs` → `skills/history`** — 템플릿 배포처로만 남던 스킬을 기록 절차 스킬로 재편. 템플릿 `worklog.md` → `history.md`(개요 / 작업 내용 / **검증 결과** / **확인 필요·후속** / 주의사항)
- **`skills/report` 제거** — 스킬 본문이 스스로 "워크로그가 정본, 보고서는 뷰"라고 규정하고 있었다. 섹션 2개를 더하려고 스킬 + 110줄 템플릿 + 디렉토리가 존재했고, 두 섹션은 `history.md`의 "4. 확인 필요·후속"으로 흡수
- **`skills/digest` 제거** — 스킬이 규정한 세 제약(원문 대체 금지·수정 파일은 원문 필독·사용 전 해시 검증)을 다 지키면 쓰는 비용이 원문을 읽는 비용에 근접한다. `checkFreshness.mjs`와 테스트 6종 함께 제거
- **`assets/hooks/blockGitMutation.mjs`** — 기록 게이트(`requireHistoryDoc`) 추가. `allowCommitPush`를 켜면 함께 켜지고, base…HEAD에 `docs/history/*.md` 변경이 없는 push를 차단한다. 게이트 대상은 커밋이 아니라 push(PR 단위)이며, base를 못 찾으면 통과시킨다(문서 위생 장치는 fail-open)
- **`assets/harness-rules.md`** — 규칙 8종 → 7종. 규칙 3을 "작업 산출물과 기록을 구분한다"로 교체하고, 규칙 7(컨텍스트 절약)은 작업하는 쪽이 아니라 설계하는 쪽의 규칙이므로 `harness` 스킬 핵심 원칙 4로 이동
- **`references/design-dialogue.md`** — "최소 3라운드 · 30분~1시간" 하한 제거. 수렴 조건 4가지가 이미 종료 기준이고, 조건이 채워졌는데 라운드를 더 도는 것은 의례다
- **`references/execution-modes.md`** — Workflow API 표·예시 제거(219→184줄). 플랫폼 `workflow-authoring` 스킬이 정본이며, 옮겨 적으면 API 변경 시 거짓말이 된다. 하네스가 쓰는 3가지와 판단 기준만 남김
- **`scripts/validateHarness.mjs`** — 템플릿 검사 6종 → 4종(history·retro·handoff·loop-spec)
- **문서 동기화** — README(스킬 11→9종, 기록 체계·규칙표·디렉토리 트리), CHANGELOG v2.0.0(마이그레이션 절차 포함), plugin.json·marketplace.json v2.0.0

## 3. 검증 결과

| 검증 | 명령 | 결과 |
|------|------|------|
| 훅 회귀 | `node --test skills/harness/scripts/hooks.test.mjs` | pass 26 / fail 0 (기록 게이트 2종 신규) |
| 검증기 회귀 | `node --test skills/harness/scripts/validateHarness.test.mjs` | pass 21 / fail 0 |
| 배포 점검 회귀 | `node --test skills/fe-predeploy/scripts/*.test.mjs` | pass 22 / fail 0 |
| 셀프 호스팅 | `node skills/harness/scripts/validateHarness.mjs .` | error 0건, warn 0건 |
| 기록 게이트 실동작 | 임시 저장소에서 훅 직접 실행 | 기록 없는 push 차단(exit 2), 기록 있는 push·커밋·저장소 밖 통과 |
| 죽은 참조 | 제거 대상 경로 전체 grep | 0건 (CHANGELOG 이력 제외) |

## 4. 확인 필요 · 후속

- **확인 필요** — 없음. 제거 범위·기록 단위(PR)·강제 수단(훅)은 착수 전 사용자 승인을 받았다.
- **후속** — 기존 하네스의 마이그레이션은 CHANGELOG v2.0.0 "Migration" 절차를 따른다. 기존 `docs/worklog/`·`docs/reports/`·`docs/digests/`는 감사 추적 자료이므로 삭제하지 않고 새 기록부터 `docs/history/`에 쓴다.

## 5. 주의사항

- **breaking 변경이다.** 기존 하네스의 에이전트 정의에 남은 "작업 완료 시 워크로그 기록"은 자동으로 갱신되지 않는다 — `docs/harness-rules.md`를 최신본으로 갱신하고 정의 문구를 함께 바꿔야 한다.
- **기록 게이트는 fail-open이다.** base 브랜치를 못 찾거나 git 호출이 실패하면 통과시킨다. 시크릿·git 변경 가드의 fail-closed와 성격이 다르며, 의도된 설계다 — 판정 불가를 차단으로 처리하면 git 환경이 다른 곳에서 push 자체가 막힌다.
- **PR 베이스가 `dev`가 아닌 저장소**는 `blockGitMutation.config.json`에 `historyBase`를 명시해야 게이트가 올바른 구간을 본다. 명시하지 않으면 자동 탐색이 엉뚱한 base를 잡아 항상 통과할 수 있다.
