# 팀 맞춤 하네스 구성 첫 MVP — 진단 → 결정 → 명세 → 적용 → 작동 확인

| 항목 | 내용 |
|------|------|
| 날짜 | 2026-09-26 |
| 브랜치 | feat/team-harness-compose |
| PR | https://github.com/Guksu/guksu-harness/pull/27 |
| 기준 | origin/main의 2878070 (v5.0.0) |
| 관련 경로 | skills/harness/scripts/teamCompose.mjs, bin/guksu-harness.mjs, skills/harness/scripts/harnessManager.mjs, skills/harness/references/team-compose.md, docs/design/2026-09-26-team-compose.md, docs/analysis/team-compose-evaluation.md |

## 1. 개요

저장소를 읽어 팀에 맞는 하네스를 구성하고 어디까지 작동하는지 네 상태로 보여 주는 명령 세 개(`diagnose`·`compose`·`verify`)를 만들었다. 구조 검사 error 0, 테스트 170개 통과(기존 155 + 새 15). 임시 저장소 3종에서 명령 흐름을 실제로 돌렸다. 실제 Claude Code·Codex 앱 안의 훅 실행과 모델의 질문 품질 평가는 실행하지 않았다. 커밋·푸시·배포는 이 작업에 포함되지 않았다.

배경: 지금까지의 guksu-harness는 정해진 파일을 설치하고 팀 수정본을 보존하며 갱신하는 도구였다. 이번 요청은 "우리 저장소를 분석하고, 우리 팀이 Claude Code와 Codex로 일할 때 필요한 하네스를 구성해줘"를 처리하는 제품으로 발전시키는 첫 MVP다. 범위는 기존 저장소에 팀 맞춤 하네스를 처음 도입하는 시나리오와 네 영역(작업 규칙·변경 보호·검증·기록·인계)으로 한정했다. 설계와 인수 시나리오는 구현 전에 `docs/design/2026-09-26-team-compose.md`에 적었다.

## 2. 작업 내용

- `skills/harness/scripts/teamCompose.mjs`(새 파일) — `diagnose`: git 기본 브랜치(origin/HEAD → main·master)·브랜치 이름의 접두어·장수 브랜치, 지침 문서(CLAUDE.md·AGENTS.md·CONTRIBUTING·PR 템플릿)의 접두어·커밋 금지·기록 의무 문장(문장 단위, "커밋 메시지는 …"은 제외), package.json 스크립트(자리표시자·의존성 미설치·실행 파일 없음 구분), CI 워크플로의 `run:` 명령과 `branches`, Makefile, 다른 생태계 표지, 기존 훅 설정·등록·설치 기록·명세, 로컬 git 훅, 민감정보 파일 존재(값은 읽지 않음)를 읽어 사실·추정·충돌·검증 명령 후보·질문·결정 초안을 만든다. `createCompose`/`applyCompose`: 결정을 명세 `.agents/harness-team.json`에 적고 훅 설정 3종(관리 키만 맞춤, 새 파일은 명시), `docs/harness-rules.md`의 마커 구간, `CLAUDE.md`·`AGENTS.md`의 포인터 구간을 만들며 기존 `createPlan`의 번들 계획과 합쳐 한 백업으로 적용한다. 미리보기 이후 변경은 다시 계산해 비교하고 거부한다. `verify`: 파일·등록·구조 검사·명세 일치(설정 완료), 임시 저장소(가짜 `.git/HEAD`)와 가짜 명령으로 설치된 훅 실행(실행 확인·실패), `--run`의 검증 명령 실행, 실제 앱 안의 실행은 항상 확인 필요로 절차를 준다.
- 결정 상태 네 가지(confirmed·evidence·assumed·pending)와 "compose가 만든 파일은 다음 진단의 근거가 되지 않는다" 규칙. 이 규칙이 없으면 재적용마다 미확인이 저장소 근거로 바뀌어 멱등이 깨졌다(구현 중 발견·수정). 생성 구간도 지침 문장 판독에서 뺀다.
- 충돌을 두 종류로 나눴다. 적용을 막는 것: 생성 파일·구간의 드리프트(그 값을 정하는 키를 `--set`으로 확정하면 해소, `--force`는 명세대로 재생성), 깨진 JSON, rules 결정과 남아 있는 verifierGate 설정, 검증 명령 없는 stop-hook, 기존 update 충돌. 진행하는 것: 지침 금지 vs 설정 허용(답이 없으면 기존 값 유지), 보호 브랜치에 기준 브랜치 없음(더한 목록 제안), CI가 부르는데 없는 스크립트(완료 조건에서 제외).
- `skills/harness/scripts/harnessManager.mjs` — `applyPlan`·`importPreset`의 백업·원자 쓰기·되돌림을 `commitChanges`로 추출. `safePath`·`atomicWrite`·`hash`·`json`·`read`·`hookPath`·`configPath`·`appFiles`·`readManifest`·`teamSpecPath` 내보내기. 명세를 export/import 묶음과 복원 대상에 추가. 기존 동작은 그대로(기존 테스트 155개 통과).
- `bin/guksu-harness.mjs` — 세 명령, 반복 옵션(`--set`), `--decisions` 파일, 사람이 읽는 출력(사실·추정·충돌·검증 명령 후보·질문과 영향·결정 초안 / 변경 목록·적용 차단 충돌·팀이 정리할 불일치·미확인 / 네 상태). `init` 안내에 한 줄 추가.
- 테스트 — `skills/harness/scripts/teamCompose.test.mjs` 14개: 인수 시나리오 3종(무엇을 사실로 찾고, 무엇을 묻고 묻지 않으며, 무엇을 바꾸고 보존하고, 무엇을 실행 확인하고 미확인으로 남기는지), 재적용 0건, 정책 하나 변경 시 닿는 파일만 변경, 구간 안 수정·설정 파일 수정의 드리프트와 해소, 미리보기 이후 변경 거부, 백업 복원으로 디렉터리 원상 복구, 기존 init 프로필 유지, 기록 요구+커밋 허용 조합, 팀 묶음의 명세 이동, 값 파싱, 워크플로 읽기, 규칙 구간 결정성. `bin/guksu-harness.test.mjs` 1개: 명령 흐름과 종료 코드.
- 문서 — `references/team-compose.md`(흐름·대화 진행법·결정 키·상태·명세·충돌·네 상태·한계), harness SKILL.md 절, README 절과 소유권 표, CHANGELOG Unreleased, installation.md·hooks-and-permissions.md·testing-guide.md 한 줄씩, 설계서, 모델 평가 명세(미실행).

## 3. 검증 결과

| 검증 | 명령·범위 | 결과 |
|------|------|------|
| 구조 검사 | `npm run check` | error 0, warn 0 |
| 전체 회귀 | `npm test` | 170개 통과 (155 기존 + 15 신규) |
| 시나리오 1 (지침 없음) | 임시 저장소에서 `diagnose` → `compose --app both --dry-run`(파일 불변) → `compose --set …` → `compose`(변경 0건) → `verify` → `rollback` | 질문 4건(apps·커밋 허용·검증 명령·기록), 적용 13건, 재적용 0건, 설정 완료 15·실행 확인 7·확인 필요 3·실패 0, 복원 13건 |
| 시나리오 2 (규칙·CI·테스트 있음) | 같은 흐름 + `--set verification.gate=stop-hook` + `verify --run` | 커밋 금지·접두어·앱을 묻지 않음(질문 2건), 기존 CLAUDE.md 보존 + 포인터 구간, 정책 변경 시 6개 파일만 변경, `npm test` 실행 확인, `npm run lint`(eslint 없음) 실패로 구분 |
| 시나리오 3 (충돌·실행 불가) | 같은 흐름 | 충돌 3건 표시, 답 없는 적용에서 허용 설정 파일 불변, 보호 브랜치에 main 추가, 자리표시자·없는 스크립트 제외, 답 뒤 3개 파일만 변경, 훅 시험은 실제 설정(허용/차단)에 맞춰 판정 |
| 드리프트·복원 | 테스트로 고정 | 구간 안 수정 → 적용 거부 → `--force` 재생성 → 백업 복원. 설정 파일 수정 → 거부 → `--set` 확정 → 해소 |
| 이 저장소 자체 진단 | `node bin/guksu-harness.mjs diagnose .` (읽기만) | 사실 5건, 파일 변경 없음. 이 저장소에는 설치하지 않았다 |
| 패키지 내용 | `npm pack --dry-run` | 64개 파일, 새 모듈·참조 문서 포함, 테스트 파일 제외 |
| diff 공백 검사 | `git diff --check` | 통과 |
| 실제 Claude Code·Codex 앱 안의 훅 실행 | 앱 내부 이벤트 | 미실행 — `verify`가 절차를 출력한다 |
| 모델 질문 품질·정책 준수 | `docs/analysis/team-compose-evaluation.md` | 미실행 |

구현 중 고친 결함: (1) `--app both` 값 파싱 오류, (2) compose가 만든 설정 파일과 생성 구간이 다음 진단의 근거가 되어 재적용이 멱등이 아니던 문제, (3) "커밋 메시지는 영어로 쓰지 않는다"를 커밋 금지로 읽던 오탐, (4) 저장소 불일치(CI가 부르는 없는 스크립트)가 적용을 영원히 막던 문제(충돌을 두 종류로 분리), (5) `historyBase`를 기준 브랜치 추정만으로 적어 훅의 기본 탐색을 좁히던 문제(팀 확정 시에만 적음).

## 4. 확인 필요 · 후속

- 실제 앱에서 확인한다: Claude Code와 Codex 각각에서 `verify`가 출력하는 절차(보호 브랜치 편집, `git commit -m test`, `cat .env` 요청) 세 가지를 시험한다. Codex는 hooks 기능 활성과 프로젝트 신뢰, `apply_patch` 차단 버전 확인이 먼저다.
- 모델 평가를 실행한다: `docs/analysis/team-compose-evaluation.md`의 시나리오 A~G를 깨끗한 세션에서 최소 3회씩 돌리고 질문 범위·미응답 처리·보고의 상태 구분을 채점한다.
- 지침 문장 판독의 오탐·미탐을 실제 팀 문서로 확인한다. 놓친 정책은 질문으로 나오고, 잘못 읽은 정책은 근거 줄이 함께 보이므로 `--set`으로 바로잡을 수 있다.
- 릴리스 여부와 버전을 정한다. 새 명령 세 개는 기존 명령을 바꾸지 않으므로 부 버전(5.1.0)이 맞아 보이나 결정은 소유자가 한다. 이 작업은 커밋·푸시·배포를 하지 않았다.
- 후속 범위(이번에 넣지 않음): 프론트엔드 전용 구성, 범용 스킬 생성, 다중 에이전트 운영, 조직 전체 관리, 자동 감시, 여러 저장소 동시 구성, 다른 생태계의 검증 명령 실행 판정, 결정 키 확장(예: PR 정책·배포 조건).

## 5. 주의사항

- 명세 `.agents/harness-team.json`은 팀 소유 파일이다. 커밋한다. 설정 파일이나 생성 구간을 손으로 고치면 다음 `compose`가 드리프트로 멈춘다. 정책은 `compose --set`으로 바꾸는 것이 기본 경로다.
- 답하지 않은 항목은 차단·최소 기본값으로 적용된다. 기존 파일이 허용이고 지침이 금지하면 파일 값을 바꾸지 않고 규칙 문서와 명세에 충돌로 표시한다. 팀이 정해야 사라진다.
- `verify`의 실행 확인은 이 도구가 실행한 스크립트·명령의 결과다. 앱 안에서 훅이 실행되는지는 별도 증거가 필요하며 항상 확인 필요로 남는다.
- `compose`는 기존 설치의 프로필을 낮추지 않고, 팀이 기록을 선택(confirmed)했을 때만 basic으로 올린다. 저장소 근거만으로 양식을 설치하지 않는다.
- 이 저장소에는 하네스를 설치하지 않았다. 설치 검증은 임시 저장소에서만 했다.
