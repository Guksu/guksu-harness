# fe-skills 접목 — 프론트엔드 네 시점 배선

| 항목 | 내용 |
|------|------|
| 날짜 | 2026-08-29 |
| 브랜치 | claude/harness-improvement-analysis-mjzm3h |
| PR | https://github.com/Guksu/guksu-harness/pull/16 |
| 관련 경로 | `skills/harness/references/frontend-domain.md`, `skills/fe-craft/`, `skills/loop/`, `README.md` |

## 1. 개요

`Guksu/fe-skills`(fe-ui 29종 · fe-system 2종)를 하네스에 접목했다. 조사해보니 연결은 이미 있었으나 방향이 하나뿐이었다 — fe-skills(소비자)의 CLAUDE.md는 `fe-craft`·`fe-predeploy`를 가리키는데, 하네스(생산자)는 fe-ui·fe-system의 존재를 몰라서 **다른** 프로젝트에 프론트엔드 하네스를 구축할 때 그 둘을 배선하지 못했다.

네 스킬은 겹치지 않고 타임라인을 이룬다(설계 판정 → 구현 → 제작 품질 → 배포 게이트). 따라서 중복 정리가 아니라 배선 문제였다.

**흡수하지 않고 포인터로 연동했다.** fe-ui 29종의 description은 설치한 모든 프로젝트의 모든 턴에 로딩되므로, 백엔드·CLI 프로젝트에는 순수 비용이다 — v2.0.0에서 잘라낸 바로 그 고정비다.

## 2. 작업 내용

- **`skills/harness/references/frontend-domain.md` (신규)** — 네 시점과 담당 스킬, fe-skills 설치 안내, 배선 위치·문구, 템플릿 범위. 프론트엔드는 분기이므로 본문이 아니라 references로 내렸다(skill-authoring의 "분리 기준은 분기다")
- **`skills/harness/SKILL.md`** — Phase 2 step 6의 프론트엔드 문단을 포인터 한 줄로 축소(내용은 위 문서로 이동), 참조 문서 표·산출물 체크리스트에 항목 추가. 본문 178→180줄이지만 프론트엔드가 아닌 구축은 배선 내용을 읽지 않는다
- **`skills/fe-craft/SKILL.md`** — "fe-ui가 설치되어 있다면" 절 추가. 이름 붙은 패턴은 직접 짜서 비평하기 전에 정본을 먼저 찾는다. 미설치 환경을 위해 조건부로 서술
- **`skills/harness/references/orchestrator-template.md`** — 종료 절차에 "설계 판정·구현·품질 스킬은 조율 대상이 아니라 작업하는 쪽의 판단" 명시
- **`verifierGate` 문서 정정** — `maxTokens` 권장 기본값 500,000 → 20,000,000, 의미(세션 transcript 누적 합계) 명시. 판정 로직은 건드리지 않았다. `loop` 스킬 Phase 2에서 "반복을 실제로 제어하는 것은 최대 반복·막힘 판정이고 토큰 예산은 마지막 방어선"으로 분리
- **문서 동기화** — README(§5-1 신설, fe-craft 절, 작업 사이클, FAQ, 저장소 구조), CHANGELOG v2.1.0, plugin.json·marketplace.json v2.1.0

## 3. 검증 결과

| 검증 | 명령 | 결과 |
|------|------|------|
| 훅 회귀 | `node --test skills/harness/scripts/hooks.test.mjs` | pass 26 / fail 0 |
| 검증기 회귀 | `node --test skills/harness/scripts/validateHarness.test.mjs` | pass 21 / fail 0 |
| 배포 점검 회귀 | fe-predeploy 2종 | pass 22 / fail 0 |
| 셀프 호스팅 | `node skills/harness/scripts/validateHarness.mjs .` | error 0건, warn 0건 (신규 reference 링크 포함) |
| README 앵커 | 내부 링크 ↔ 헤딩 대조 | 깨진 앵커 0건 |

## 4. 확인 필요 · 후속

- **확인 필요** — 없음. 접목 방식(포인터 연동)·마이그레이션 범위·게이트 버그 처리는 착수 전 사용자 승인을 받았다.
- **후속 1** — fe-skills 저장소 자체의 하네스 v2.0.0 마이그레이션(규칙 7종·`docs/history/` 전환). 사용자 결정으로 이번 범위에서 제외했고, CHANGELOG v2.0.0의 Migration 절차를 실제로 검증하는 첫 사례가 된다.
- **후속 2** — `verifierGate`의 `maxTokens` 판정 로직 자체(세션 누적 기준)는 사용자 판단으로 유지했다. 문서만 정정했으므로, 루프 1회분 예산을 강제하려면 별도 설계가 필요하다.

## 5. 주의사항

- **fe-ui·fe-system은 이 저장소에 없다.** 별도 마켓플레이스이므로 사용자가 설치해야 하고, 하네스는 **설치 여부를 확인한 뒤 설치한 것만** 배선한다. 확인 없이 배선하면 없는 스킬을 가리키는 dead link가 되고, 에이전트가 찾다 실패하면 그 정의 전체의 신뢰가 떨어진다.
- **fe-system과 Phase 1 설계 문답은 경쟁하지 않는다** — 대상이 다르다(하네스 자체 vs 기능의 구현 설계). 이 구분이 흐려지면 프론트 요청마다 설계 문답이 두 번 도는 설계가 나온다.
- 이 기록은 PR #16의 두 번째 작업 단위다. v2.0.0(다이어트)과 v2.1.0(접목)이 한 PR에 들어 있으므로, 리뷰 시 CHANGELOG의 두 항목을 나눠 본다.
