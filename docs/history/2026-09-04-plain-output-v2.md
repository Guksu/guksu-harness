# 독자 기준 출력 — eli5 원리를 절대 규칙 7에 접목

| 항목 | 내용 |
|------|------|
| 날짜 | 2026-09-04 |
| 브랜치 | feat/plain-output-v2 |
| PR | https://github.com/Guksu/guksu-harness/pull/18 |
| 관련 경로 | `skills/harness/assets/harness-rules.md`, `skills/harness/references/plain-output.md`, `skills/harness/scripts/validateHarness.mjs`, `skills/history/assets/templates/`, `README.md` |

## 1. 개요

절대 규칙 7("출력은 읽는 사람이 이해할 수 있게 쓴다")에 **구조와 형식**을 더했고, 검증기가 구버전 규칙 파일을 잡게 했으며, README를 같은 기준으로 다듬었다. 규칙 수는 7종 그대로다. 테스트 77종과 셀프 검증이 모두 통과했다.

계기는 Anthropic 커뮤니티 플러그인의 `eli5` 스킬이다. 10줄짜리 파일 하나로 "아무것도 모르는 사람에게, 그림은 크게 글은 적게"라는 독자 가정과 매체 제약만 고정해 설명 품질을 바꾼다. 기존 규칙 7은 문장 단위(용어 풀이·한 문장 하나의 내용)만 다뤘고, 보고의 순서(결론이 먼저인가)와 형식(경로 나열 산문인가, 표인가)은 비어 있었다.

**한 가지 우회가 있었다.** 첫 작업은 v1.16.0 기준의 오래된 로컬 checkout에서 진행됐고, 그때는 규칙 8을 새로 만들었다. 원격 main이 v2.1.0이고 이미 "쉬운 출력" 규칙(v1.17.0 신설, v2.0.0에서 7번으로 이동)이 있음을 PR 직전에 확인해, 중복되지 않는 부분만 2.1.0 위에 다시 얹었다. 그 초안은 `feat/plain-output` 브랜치에 커밋으로 남아 있다(참고용, 머지 대상 아님).

## 2. 작업 내용

- **`skills/harness/assets/harness-rules.md` 규칙 7 확장** — 독자 가정("이 대화를 보지 못했고 코드를 모르는 사람"), 순서(결론 → 사용자가 할 일 → 근거, 실패·미검증은 결론에 먼저), 경로·명령·수치는 산문이 아니라 표·목록·코드 블록에, 항목 비교·판정·흐름은 표·배지·다이어그램으로. `skills/harness/SKILL.md`의 규칙 7 본문도 동기화
- **`skills/harness/references/plain-output.md` (신규, 145줄)** — 규칙 7 상세. 독자 모델 3종, 결론→할 일→근거 구조, 문장 규칙, 용어 처리, 형식 선택표, 매체별 형식 7종, 안티패턴 7, Before/After 2, 점검 질문 6. 설계 문답의 질문 규칙은 `design-dialogue.md` §5를 정본으로 가리킨다
- **`skills/harness/scripts/validateHarness.mjs`** — `validateRulesFile` 추가. 프로젝트 `docs/harness-rules.md`가 없으면 warn, 규칙 수(`N. **` 줄 수)가 플러그인 정본보다 적으면 "구버전" warn. 정본을 못 찾으면 비교를 생략한다. 테스트 3종 추가(`validateHarness.test.mjs`)
- **`skills/harness/SKILL.md`** — Phase 0 감사 항목에 규칙 파일 누락·구버전, Phase 2-1에 구버전 경고 시 갱신 절차(사용자 확인 후 누락 규칙만 추가, 프로젝트가 손본 문구 보존), Phase 3-6 출력 가독성 점검, 체크리스트 항목, 참조 표에 plain-output 행. 참조 표의 `context-economy.md` 행이 "절대 규칙 7"을 가리키던 오류를 "핵심 원칙 4"로, `references/design-dialogue.md` §5의 "절대 규칙 8"을 "7"로 정정 — v2.0.0에서 규칙 번호가 이동했는데 두 곳이 남아 있었다
- **템플릿 3종** (`skills/history/assets/templates/`) — history(안내 주석에 독자 가정, 개요 첫 문장은 결론, 확인 필요·후속은 동사 항목), handoff(용어 풀이·행동 문장), predeploy(fail은 "사용자에게 어떤 일이 생기는가"로)
- **스킬 4종 보고 절차** — `history`(독자 기준 기록 한 줄), `handoff`(용어 풀이·행동 문장), `fe-predeploy`(판정을 첫 문장으로, fail 풀이 예시), `fe-craft`(Why에 원칙 이름 + 사용자에게 보이는 증상)
- **`references/orchestrator-template.md`·`references/agent-design.md`** — 종료 절차·입출력 계약에 "사용자 대면 보고: 결론 → 할 일 → 근거" 한 줄
- **README** — "30초 요약"(결론 한 문장 + 할 일 3단계 표 + 상황별 읽기 안내) 신설, 용어 사전에 정의 없이 쓰이던 8개(CLAUDE.md·description·실행 모드·티어·TDD·경계면 QA·git-flow·blocker) 추가, §1 산출물 표에 규칙 파일 행, §4-6 "여기까지 됐다면", §5 세 곳(validateHarness 검사 항목·fe-predeploy 실패 풀이·fe-craft Why 풀이), §6 사이클 다이어그램에 "보고" 노드와 종료 보고 예시, §7 규칙 7 행, §8-5 신설, §12 갱신. 733→762줄이며 늘어난 부분은 표·예시·용어 정의다
- **버전** — plugin.json·marketplace.json·README·CHANGELOG v2.2.0

## 3. 검증 결과

| 검증 | 명령 | 결과 |
|------|------|------|
| 회귀 테스트 전체 | `node --test skills/harness/scripts/*.test.mjs skills/fe-predeploy/scripts/*.test.mjs` | pass 77 / fail 0 (74 + 신규 3) |
| 셀프 호스팅 검증 | `node skills/harness/scripts/validateHarness.mjs .` | error 0건, warn 0건 (신규 reference 링크 포함) |
| 규칙 파일 검사 실동작 | 테스트 픽스처 — 파일 없음 / 규칙 3종 / 정본 그대로 | 각각 warn / 구버전 warn / 경고 없음 |
| 문구 정합성 | `grep "규칙 8"` (README·skills) | 0건 — 신규 규칙 번호를 만들지 않았음 |

## 4. 확인 필요 · 후속

- **PR 베이스를 `main`으로 올렸다** — 이 저장소에는 `dev` 브랜치가 없다. git-flow를 도입할 계획이면 `dev`를 만든 뒤 베이스를 바꿔야 한다
- **머지 후 기존 하네스 프로젝트에서 `/guksu-harness:harness 점검`을 실행하면** 규칙 파일이 구버전(규칙 7 문구 차이는 잡지 못하고 규칙 *수*만 비교한다)일 때 경고가 뜬다. 규칙 수가 같은 v2.0.0 이후 사본은 경고 없이 통과하므로, 규칙 7의 확장 문구는 프로젝트가 직접 옮겨야 한다
- 참고용 초안 브랜치 `feat/plain-output`은 삭제해도 된다(사용자 전담)

## 5. 주의사항

- 검증기의 규칙 수 비교는 `N. **` 패턴의 줄 수다. 규칙 문구만 바뀌고 수가 같으면 감지하지 못한다 — 문구 비교는 프로젝트가 의도적으로 손본 문구까지 오탐하므로 넣지 않았다
- `plain-output.md`를 다른 스킬 본문에서 가리킬 때 `references/plain-output.md`라고 쓰면 검증기가 그 스킬의 로컬 참조로 오인해 error를 낸다. harness 스킬 밖에서는 "harness 스킬의 `plain-output.md` 참조 문서"로 쓴다
