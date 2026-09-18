# Codex 지원 — 앱 중립 위치와 앱별 훅 등록

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-09-18 |
| 브랜치 | claude/focused-planck-898vo6 |
| PR | https://github.com/Guksu/guksu-harness/pull/20 |
| 기준 | origin/main의 3977205 (v2.3.0) |
| 버전 | 3.0.0 |

## 1. 개요

Codex(OpenAI Codex CLI)에서도 이 플러그인의 스킬 9종과 훅 4종을 쓸 수 있게 했다. 구조 검사와 테스트 118개가 통과했다. 실제 Codex 앱 안에서의 훅 실행은 이 환경에서 확인하지 못했다. 사용자가 로컬 Codex에서 확인하기로 했다.

배경: 스킬 형식(SKILL.md + name·description)은 두 앱이 같지만, 플러그인 설명 파일·스킬 경로·규칙 파일 이름·훅 등록 파일이 달랐다. 관리 스크립트와 검사 스크립트가 `.claude/` 경로를 고정으로 썼다. 사용자 결정: 훅까지 지원하고, 훅 파일은 앱 중립 위치에 둔다.

## 2. 작업 내용

- `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json` — Codex 플러그인 설명 파일 추가. `skills/`는 공유. 훅은 플러그인에 번들하지 않는다(설정 파일이 프로젝트 옆에 있어야 하므로 프로젝트별 등록 유지).
- `skills/harness/scripts/harnessManager.mjs` — 관리 파일을 `.agents/hooks/`·`.agents/harness-install.json`·`.agents/harness-backups/`로 이동. `--app claude|codex|both` 추가(생략 시 프로젝트 파일로 추정, 추적 기록에 저장). Codex 등록은 `.codex/hooks.json`에 상대 경로 명령·`apply_patch|Edit|Write` matcher. v2 설치본(`.claude/hooks/`·설정·추적 기록·등록)을 새 위치로 옮기고 수정본·참조 중인 파일은 충돌로 보존. 상태 진단에 앱별 등록·이전 위치 경고 추가.
- `skills/harness/scripts/validateHarness.mjs` — `.agents/skills/`·`AGENTS.md`·`.codex/hooks.json`·`.codex-plugin` 검사 추가. Read deny 경고는 codex 등록만 있는 프로젝트에 요구하지 않는다.
- `skills/harness/assets/hooks/*.mjs` — 프로젝트 경로를 stdin `cwd` 우선으로 읽고, 기록 게이트의 git을 `cwd`에서 실행. 주석에 앱별 matcher·입력 차이 명시.
- 테스트 — 관리자 8건, 훅 2건, 검사기 7건 추가. 기존 테스트는 새 경로로 갱신.
- 문서 — README(Codex 설치·호출·확인 사항), `hooks-and-permissions.md`(앱별 등록 형식·§8 확인 절차), `installation.md`(경로 표·`--app`·v2 이동), harness SKILL.md, `testing-guide.md`, `context-economy.md`(Claude Code 전용 표시), branch·pr·fe-craft·fe-predeploy·retro 스킬의 경로 표현, `.gitignore`, CHANGELOG 3.0.0.

## 3. 검증 결과

| 검증 | 명령 | 결과 |
|---|---|---|
| 구조 검사 | `node skills/harness/scripts/validateHarness.mjs .` | error 0 · warn 0 |
| 전체 테스트 | `node --test skills/harness/scripts/*.test.mjs skills/fe-predeploy/scripts/*.test.mjs` | 118 통과 · 실패 0 |
| v2 이동 재현 | v2.3.0 형태 설치본을 만들어 plan·apply | 훅·설정·추적 기록 이동, 등록 교체, 재적용 변경 0건 |
| codex·both 설치·제거 | 테스트 내 임시 프로젝트 | 통과 |
| codex 형식 훅 입력 | `CLAUDE_PROJECT_DIR` 없이 `apply_patch` 입력 | 보호 브랜치 차단(exit 2) 확인 |
| 실제 Codex 앱 | 훅 실행·플러그인 설치 | 미실행 — 이 환경에 Codex 없음, 공식 문서 사이트 차단 |

## 4. 확인 필요 · 후속

- 사용자가 로컬 Codex에서 `hooks-and-permissions.md` §8의 3단계 확인을 수행한다(보호 브랜치 편집, `git commit`, `cat .env`). 결과를 이 기록에 추가한다.
- Codex 훅 프로세스의 현재 디렉터리가 프로젝트 루트가 아니면 `.codex/hooks.json`의 상대 경로 명령을 절대 경로 또는 Codex가 제공하는 변수로 바꿔야 한다. 확인 결과에 따라 `hookEntry`의 codex 명령 형식을 수정한다.
- Codex에서 `apply_patch` 차단이 안 되면(openai/codex #27833) README의 주의 문구를 유지하고, 고쳐진 버전을 확인하면 문구를 갱신한다.
- `codex plugin marketplace add Guksu/guksu-harness` 설치가 되는지 확인한다. 마켓 파일의 `policy`·`category` 값은 공개 저장소(openai/plugins, cockroachdb/codex-plugin)의 형식을 따랐다.

## 5. 주의사항

- v2 설치본은 업데이트 계획에 이동이 포함된다. 직접 수정한 훅은 옮기지 않고 충돌로 남는다. 빈 `.claude/hooks/` 디렉터리는 남을 수 있다.
- Read deny는 Claude Code 전용이다. Codex에서는 Bash 훅과 규칙 문서만 민감정보를 막는다.
- verifierGate의 `maxTokens`는 Codex transcript 형식을 확인하지 못했다. Codex에서는 `maxIterations`·`stuckAfter`만 믿는다.
- 스킬 호출 이름이 다르다. Claude Code `/guksu-harness:harness`, Codex `$harness`.
