# Changelog

이 프로젝트는 [Semantic Versioning](https://semver.org/)을 따른다.

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
