# Changelog

이 프로젝트는 [Semantic Versioning](https://semver.org/)을 따른다.

## [1.2.0] - 2026-07-02

### Changed

- **에이전트 팀 API 현행화** — `TeamCreate`/`TeamDelete` 기반 골격을 현행 모델(암시적 단일 팀 + `Agent(name)` 스폰 + `SendMessage` 컨텍스트 유지 + `TaskCreate` 공유 작업 목록)로 교체. `team_name` 파라미터 deprecated 명시, Phase 전환은 새 팀원 스폰으로 (execution-modes / orchestrator-template / SKILL.md)
- **git 차단 훅 우회 봉합** — `git -C <path> commit`·`git -c <k=v> push`처럼 값을 별도 인자로 받는 전역 플래그가 판정 정규식을 우회하던 결함 수정, `worktree` 추가
- **agentType dead-link 검사를 error → warn으로 조정** — 새 빌트인 타입 오탐이 통과 기준(error 0건)을 깨지 않도록. 메시지에 커스텀/빌트인 분기 안내 포함

### Added

- **훅 스크립트 번들** (`assets/hooks/`) — `blockGitMutation.mjs` + `blockSecretAccess.mjs`를 실물 파일로 배포, 문서 코드블록 복사 방식 폐지. 회귀 테스트 4종(`scripts/hooks.test.mjs`) 포함
- **시크릿 Bash 우회 차단 훅** (`blockSecretAccess.mjs`) — permissions.deny는 Read 도구만 막고 `cat .env` 같은 Bash 경유 읽기는 통과하던 구멍을 PreToolUse 훅으로 봉합. `.env.example` 등 예시 파일은 허용
- **TDD 종료 게이트 (Stop 훅, 선택)** — 테스트 실패 상태로 턴 종료를 차단해 절대 규칙 2를 기계적으로 강제. `stop_hook_active` 무한 루프 가드 포함 (hooks-and-permissions.md)
- **Workflow 최신 기능 반영** — `.claude/workflows/` 저장 워크플로우를 Workflow 모드 산출물로, `resumeFromRunId` 캐시 재개를 부분 재실행 수단으로, `scriptPath` 반복 수정, `workflow()` 중첩 호출, `opts.effort` 정책(세션 상속 기본), journal.jsonl 디버깅 (execution-modes / orchestrator-template / agent-design)
- **validateHarness 검사 4종 확장** — (1) 하네스 존재 시 git 훅·시크릿 deny 미구성 warn, (2) `.claude/commands/` 파일 존재 warn, (3) 오케스트레이터 스킬의 `## 테스트 시나리오` 섹션 부재 warn, (4) frontmatter 멀티라인 값(`>-` 블록 스칼라·들여쓴 연속 줄) 파싱 지원. 테스트 12종 → 17종

### Fixed

- plugin.json·marketplace.json description의 팀 중심 구식 표현("에이전트 팀과 스킬 세트")을 모드 중립 표현("에이전트 정의와 스킬 세트")으로 통일

## [1.1.0] - 2026-06-10

### Added

- **훅·권한 가이드** (`references/hooks-and-permissions.md`) — 절대 규칙 1(git)·6(시크릿)을 PreToolUse 훅 + permissions deny로 기계적으로 강제, 테스트·빌드 명령 allowlist로 자율 실행 보장, 기존 설정 병합 규칙. Phase 2에 훅·권한 구성 단계 추가
- **인자 해석** — `/harness <인자>` 슬래시 명령어 호출 시 인자(구축/점검/추가/해체 등)로 Phase 0 분기를 선결정하는 표
- **해체(teardown) 분기** — Phase 0에 네 번째 분기 추가. 참조 제거 → 파일 삭제 순서, CLAUDE.md 정리, 산출물 처분 사용자 확인, 재검증의 5단계 역순 절차
- **validateHarness 검사 3종 확장** — (1) 스킬 본문의 `agentType`/`agent_type`/`subagent_type` 참조 ↔ 에이전트 정의 실존 대조(error), (2) description 후속 작업 키워드 누락(warn), (3) CLAUDE.md 하네스 포인터 부재(warn). 테스트 7종 → 12종
- **절대 규칙 6 — 시크릿 차단** — `.env`·credential 읽기 금지, 산출물에 토큰/키 기록 금지. SKILL.md·에이전트 템플릿·오케스트레이터 템플릿에 반영
- README에 슬래시 명령어 사용법(`/guksu-harness:harness <요청>`) 추가

## [1.0.0] - 2026-06-10

### Added

- `harness` 메타 스킬 초기 릴리스 — 감사 → 설계 → 구축 → 검증 → 등록·진화 5 Phase
- **Workflow 1급 실행 모드** — 결정적 오케스트레이션(pipeline/parallel, 스키마 출력, 토큰 버짓)을 에이전트 팀·서브 에이전트와 동급 선택지로, "제어 흐름을 코드로 쓸 수 있는가" 결정 트리 포함 (`references/execution-modes.md`)
- **모델 정책 현대화** — 모델 하드코딩 금지, 세션 모델 상속 기본, 오버라이드는 이유 명시 시에만
- **절대 규칙 5종 내장** — git 사용자 전담 / TDD 기본 / 파일 기반 산출물 / 단일 출처 문서 / 경계면 교차검증 incremental QA
- `validateHarness.mjs` 구조 검증기 + node:test 테스트 7종 (frontmatter, name-디렉토리 일치, references 링크, 500줄 경고, manifest 버전 정합성)
- references 5종 — execution-modes / agent-design / skill-authoring / orchestrator-template / testing-guide
- 플러그인 마켓플레이스 배포 형태 (`.claude-plugin/marketplace.json` + `plugin.json`)
