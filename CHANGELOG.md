# Changelog

이 프로젝트는 [Semantic Versioning](https://semver.org/)을 따른다.

## [1.0.0] - 2026-06-10

### Added

- `harness` 메타 스킬 초기 릴리스 — 감사 → 설계 → 구축 → 검증 → 등록·진화 5 Phase
- **Workflow 1급 실행 모드** — 결정적 오케스트레이션(pipeline/parallel, 스키마 출력, 토큰 버짓)을 에이전트 팀·서브 에이전트와 동급 선택지로, "제어 흐름을 코드로 쓸 수 있는가" 결정 트리 포함 (`references/execution-modes.md`)
- **모델 정책 현대화** — 모델 하드코딩 금지, 세션 모델 상속 기본, 오버라이드는 이유 명시 시에만
- **절대 규칙 5종 내장** — git 사용자 전담 / TDD 기본 / 파일 기반 산출물 / 단일 출처 문서 / 경계면 교차검증 incremental QA
- `validateHarness.mjs` 구조 검증기 + node:test 테스트 7종 (frontmatter, name-디렉토리 일치, references 링크, 500줄 경고, manifest 버전 정합성)
- references 5종 — execution-modes / agent-design / skill-authoring / orchestrator-template / testing-guide
- 플러그인 마켓플레이스 배포 형태 (`.claude-plugin/marketplace.json` + `plugin.json`)
