# 작업 기록 대상 축소와 색인

| 항목 | 내용 |
|------|------|
| 날짜 | 2026-09-30 |
| 유형 | 기능, 정책 |
| 브랜치 | feat/history-record-scope |
| PR | https://github.com/Guksu/guksu-harness/pull/29 |
| 관련 경로 | `skills/history/`, `skills/harness/assets/hooks/blockGitMutation.mjs`, `docs/history/README.md` |

## 1. 개요

작업 기록은 이제 버그·핫픽스·기능·호환성 변경·정책 변경에만 남긴다. 기록 게이트 훅은 커밋 제목의 타입으로 대상을 판정한다. 기록을 찾을 때는 색인 한 파일을 먼저 읽는다. 실제 Claude Code·Codex 앱 안에서 훅이 실행되는지는 확인하지 못했다.

배경: 기록 게이트가 켜지면 모든 PR에 기록 문서가 생긴다. 어떤 작업의 기록인지 모르면 에이전트가 `docs/history/` 전체를 grep해야 한다. 이 저장소만 해도 기록 13건, 약 65KB다. 그래서 세 가지를 했다. 기록 대상을 좁혔다. 색인을 만들었다. 양식에 유형 칸을 넣었다.

## 2. 작업 내용

- `skills/history/SKILL.md` — 기록 대상 표(유형과 커밋 타입), 색인 갱신 절차, "색인 먼저 읽고 필요한 문서만 연다"는 찾는 법을 추가했다.
- `skills/history/assets/templates/history.md`, `docs/templates/history.md` — 머리 표에 "유형" 행을 추가했다. 두 파일은 같은 내용이다.
- `skills/history/assets/templates/history-index.md` — 색인 양식. 기록 하나에 한 줄(날짜·유형·버전·제목·요약)이다.
- `docs/history/README.md` — 이 저장소의 색인. 기존 13건의 유형과 버전은 각 기록의 원래 커밋 제목과 CHANGELOG에서 정했다. 기존 기록 파일은 고치지 않았다.
- `skills/harness/assets/hooks/blockGitMutation.mjs` — 기록 게이트가 `base..HEAD` 커밋(병합 제외)을 읽는다. 아래 중 하나가 있을 때만 기록 문서를 요구한다.
  - 대상 타입 커밋. 기본값은 `fix`·`hotfix`·`feat`·`policy`이고 `historyCommitTypes`로 바꾼다.
  - 호환성 변경. `타입!:` 제목 또는 `BREAKING CHANGE:` 꼬리말이다.
  - Conventional Commits 형식이 아닌 커밋. 형식을 안 쓰는 팀에서 게이트가 조용히 꺼지지 않게 하려고 대상으로 본다.
  - 색인 `README.md`만 바꾼 것은 기록으로 치지 않는다.
- `skills/harness/scripts/validateHarness.mjs` — 색인이 있으면 색인에 없는 기록 문서를 경고한다. 색인이 없으면 검사하지 않는다.
- `skills/harness/scripts/teamCompose.mjs` — `records.history: required`의 선택지 설명과 규칙 문서 문구를 새 기준으로 바꿨다. 기록 개수를 셀 때 색인은 뺀다.
- `skills/pr/SKILL.md`, `skills/retro/SKILL.md`, `skills/harness/references/hooks-and-permissions.md`, `skills/harness/references/team-customization.md`, `README.md`, `CHANGELOG.md` — 새 기준과 설정값을 반영했다.

## 3. 검증 결과

| 검증 | 명령 | 결과 |
|------|------|------|
| 구조 검사 | `npm run check` | error 0 · warn 0 |
| 전체 테스트 | `npm test` | 176 통과 · 실패 0 (기존 170 + 새 6) |
| 실제 저장소 훅 실행 | 이 브랜치와 시험용 임시 브랜치에서 훅 스크립트에 push 명령 입력, 기준 `origin/main` | 아래 표 |

| 브랜치 상태 | 설정 | 결과 |
|---|---|---|
| 이 브랜치 그대로 (`feat` 커밋 + 기록 문서) | 기본 | 통과 (exit 0) |
| 기록 문서만 뺀 상태 | 기본 | 차단 (exit 2), 메시지에 `feat:` 커밋 제목 표시 |
| `docs:` 커밋만 있고 기록 없음 | 기본 | 통과 (exit 0) |
| 같은 상태 | `historyCommitTypes: ["*"]` | 차단 (exit 2) |

새 테스트가 확인하는 것:

- 타입 판정: 범위 표기, 대문자 타입, `!`, `BREAKING CHANGE:` 꼬리말, 형식 없는 제목, 콜론 앞 공백, `["*"]`, 대상 축소.
- 설정값: 생략, 공백·대문자 정리, 잘못된 값은 모든 push에 요구.
- 임시 git 저장소에서 훅 CLI: `docs:` 커밋만 있으면 통과. `fix:` 커밋이 생기면 차단되고 메시지에 그 커밋 제목이 나온다. 색인만 추가하면 계속 차단. 기록 문서를 추가하면 통과.
- 구조 검사: 색인에 없는 기록 경고, 색인이 없으면 검사 안 함.

## 4. 확인 필요 · 후속

- 실제 Claude Code·Codex 앱 안에서 훅이 차단 메시지를 보여 주는지 확인한다. 이 환경에서는 훅 스크립트를 직접 실행해서만 확인했다.
- `policy`는 Conventional Commits 표준 타입이 아니다. commitlint 기본 설정을 쓰는 팀은 `policy`를 허용 타입에 추가하거나, `historyCommitTypes`에서 빼고 정책 변경을 다른 타입으로 표시할지 정한다.
- 다음 릴리스 PR에서 CHANGELOG의 Unreleased를 버전 항목으로 바꾼다. 기존 게이트 동작이 넓어지는 것이 아니라 좁아지는 변경이라 부 버전(5.2.0)을 제안한다.

## 5. 주의사항

- 커밋 제목의 타입이 틀리면 판정도 틀린다. 예를 들어 버그 수정을 `chore:`로 쓰면 기록을 요구하지 않는다. 훅은 제목만 보고 내용은 보지 않는다.
- `requireHistoryDoc`이 켜진 기존 프로젝트는 `update` 뒤 문서·리팩터링·테스트 커밋만 있는 push에 기록을 요구하지 않는다. 이전 동작이 필요하면 `"historyCommitTypes": ["*"]`를 설정한다.
- 훅은 로컬의 기준 브랜치 참조로 비교한다. 로컬 `origin/main`이 오래되면 비교 범위에 옛 기록 문서가 섞여 게이트가 통과한다. 이번 실행 확인에서 실제로 겪었고, `git fetch origin main` 뒤 다시 확인했다. 이 동작은 이번 변경 전부터 있었다.
- 릴리스 준비 PR(`chore:`)은 기록 대상이 아니다. 버전 내용은 CHANGELOG가 맡는다.
- 되돌릴 때: 훅의 `historyRequired` 판정을 빼면 이전처럼 모든 push에 기록을 요구한다. 색인과 유형 행은 남아도 동작에 영향이 없다.
