# fe-skills 접목 — 라이브러리로 가져다 쓰기

| 항목 | 내용 |
|------|------|
| 날짜 | 2026-08-29 |
| 브랜치 | claude/harness-improvement-analysis-mjzm3h |
| PR | https://github.com/Guksu/guksu-harness/pull/17 |
| 관련 경로 | `skills/harness/scripts/feSkills.mjs`, `skills/harness/references/frontend-domain.md`, `skills/fe-craft/`, `README.md` |

## 1. 개요

`Guksu/fe-skills`(fe-ui 29종 · fe-system 2종)를 하네스에 접목했다. 조사해보니 연결은 이미 있었으나 방향이 하나뿐이었다 — fe-skills(소비자)의 CLAUDE.md는 `fe-craft`·`fe-predeploy`를 가리키는데, 하네스(생산자)는 fe-ui·fe-system의 존재를 몰라서 **다른** 프로젝트에 프론트엔드 하네스를 구축할 때 그 둘을 배선하지 못했다.

네 스킬은 겹치지 않고 타임라인을 이룬다(설계 판정 → 구현 → 제작 품질 → 배포 게이트). 따라서 중복 정리가 아니라 배선 문제였다.

**설치가 아니라 라이브러리 사용이다.** 첫 시도에서 "플러그인 설치를 안내하고 확인받아 배선"으로 만들었으나, 사용자가 원한 것은 **요청 없이 자동으로, 필요한 것만 가져다 쓰는** 방식이었다. 설치 방식은 두 가지가 틀렸다: ① 사용자가 매번 설치를 결정해야 하고 ② 설치하면 description 31개가 모든 프로젝트의 모든 턴에 로딩된다(v2.0.0에서 잘라낸 바로 그 고정비). npm처럼 쓸 것만 받는 방식이 둘 다 해결한다.

## 2. 작업 내용

- **`skills/harness/scripts/feSkills.mjs` (신규)** — 라이브러리 클라이언트. `find <요청 문장>`으로 후보를 순위대로(사용자 표현 그대로 검색, 한글 조사 처리), `get <slug> --into <대상>`으로 SKILL.md 경로 출력 + 정본 코드 복사 + 출처 표기, `list`로 전체 31종. 캐시는 얕은 클론이고 **갱신 실패 시 기존 캐시로 진행**한다 — 낡은 라이브러리가 없는 라이브러리보다 낫다. 캐시도 네트워크도 없으면 exit 3으로 알리되 작업은 멈추지 않는다(직접 구현 + 기록)
- **자동 발동 배선** — Phase 2에서 스크립트를 프로젝트 `.claude/scripts/`로 복사하고(플러그인 미설치 세션에서도 동작), 도메인 스킬·developer 정의에 "UI 패턴 구현·화면 설계 전 라이브러리 먼저 조회"를 **완료 기준과 함께** 넣는다. 완료 기준을 빼면 바쁜 실행에서 건너뛰어진다
- **`skills/harness/references/frontend-domain.md` (신규)** — 네 시점, 라이브러리 사용법, 자동 발동시키는 방법, 출처 기록. 프론트엔드는 분기이므로 본문이 아니라 references로 내렸다(skill-authoring의 "분리 기준은 분기다")
- **`skills/harness/SKILL.md`** — Phase 2 step 6의 프론트엔드 문단을 포인터 한 줄로 축소(내용은 위 문서로 이동), 참조 문서 표·산출물 체크리스트에 항목 추가. 본문 178→180줄이지만 프론트엔드가 아닌 구축은 배선 내용을 읽지 않는다
- **`skills/fe-craft/SKILL.md`** — "새 패턴을 만들기 전에 라이브러리를 먼저 조회한다" 절 추가. 사용자 요청 여부와 무관하게 발동한다
- **`skills/harness/references/orchestrator-template.md`** — 종료 절차에 "설계 판정·구현·품질 스킬은 조율 대상이 아니라 작업하는 쪽의 판단" 명시
- **`verifierGate` 문서 정정** — `maxTokens` 권장 기본값 500,000 → 20,000,000, 의미(세션 transcript 누적 합계) 명시. 판정 로직은 건드리지 않았다. `loop` 스킬 Phase 2에서 "반복을 실제로 제어하는 것은 최대 반복·막힘 판정이고 토큰 예산은 마지막 방어선"으로 분리
- **문서 동기화** — README(§5-1 신설, fe-craft 절, 작업 사이클, FAQ, 저장소 구조), CHANGELOG v2.1.0, plugin.json·marketplace.json v2.1.0

## 3. 검증 결과

| 검증 | 명령 | 결과 |
|------|------|------|
| 훅 회귀 | `node --test skills/harness/scripts/hooks.test.mjs` | pass 26 / fail 0 |
| 검증기 회귀 | `node --test skills/harness/scripts/validateHarness.test.mjs` | pass 21 / fail 0 |
| fe-skills 클라이언트 | `node --test skills/harness/scripts/feSkills.test.mjs` | pass 5 / fail 0 (신규) |
| 배포 점검 회귀 | fe-predeploy 2종 | pass 22 / fail 0 |
| 라이브러리 실동작 | 실제 저장소 클론 후 find·get 실행 | 31종 카탈로그, "바텀시트로 메뉴 고르게"→bottom-sheet, "상품 목록에 필터"→list-filter-detail, 정본 3개 복사 |
| 셀프 호스팅 | `node skills/harness/scripts/validateHarness.mjs .` | error 0건, warn 0건 (신규 reference 링크 포함) |
| README 앵커 | 내부 링크 ↔ 헤딩 대조 | 깨진 앵커 0건 |

## 4. 확인 필요 · 후속

- **확인 필요** — 없음. 접목 방식(포인터 연동)·마이그레이션 범위·게이트 버그 처리는 착수 전 사용자 승인을 받았다.
- **후속 1** — fe-skills 저장소 자체의 하네스 v2.0.0 마이그레이션(규칙 7종·`docs/history/` 전환). 사용자 결정으로 이번 범위에서 제외했고, CHANGELOG v2.0.0의 Migration 절차를 실제로 검증하는 첫 사례가 된다.
- **후속 2** — `verifierGate`의 `maxTokens` 판정 로직 자체(세션 누적 기준)는 사용자 판단으로 유지했다. 문서만 정정했으므로, 루프 1회분 예산을 강제하려면 별도 설계가 필요하다.

## 5. 주의사항

- **가져온 코드는 그 프로젝트의 코드가 된다.** 라이브러리가 개선돼도 자동으로 따라가지 않으므로, 무엇을 가져왔는지 작업 기록에 남겨야 나중에 다시 가져올 대상을 알 수 있다. `get`은 덮어쓴 파일을 보고하므로 프로젝트에서 수정한 사본을 조용히 지우지 않는다.
- **라이브러리 없이도 작업은 진행돼야 한다.** 후보 0건·네트워크 없음은 실패가 아니라 "직접 구현" 신호다. 여기서 멈추는 설계로 바꾸면 오프라인에서 프론트 작업 자체가 막힌다.
- **fe-system과 Phase 1 설계 문답은 경쟁하지 않는다** — 대상이 다르다(하네스 자체 vs 기능의 구현 설계). 이 구분이 흐려지면 프론트 요청마다 설계 문답이 두 번 도는 설계가 나온다.
- **이 작업은 PR #16과 별개다.** v2.0.0(다이어트)은 PR #16으로 먼저 머지됐고, 이 v2.1.0 작업은 그 위에 리베이스해 PR #17로 올렸다 — 머지된 PR은 새 작업을 담을 수 없다.
