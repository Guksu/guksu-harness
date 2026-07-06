# Changelog

이 프로젝트는 [Semantic Versioning](https://semver.org/)을 따른다.

## [1.5.0] - 2026-07-06

### Added

- **`handoff` 스킬 (신규)** — 진행 중 작업을 인계 문서(목표/진행 상황/시도와 결과/다음 단계/미해결 질문)로 옮겨 세션 간 연속성을 보장하는 스킬. 작성·갱신/인수 두 모드, 작업 흐름당 1개 갱신형 문서(`docs/handoff/{slug}.md`), "시도와 결과" 누적 기록(막다른 길 반복 방지), 인수 시 근거 파일 실검증, 완료 시 워크로그로 최종 기록 이관
- **인계 템플릿** (`skills/docs/assets/templates/handoff.md`) — docs 스킬 템플릿 3종 체제(worklog + retro + handoff)
- **오케스트레이터 에러 핸들링에 인계 추가** — 세션 중단·컨텍스트 한계 임박 시 handoff 스킬로 인계 문서 작성 후 중단 (orchestrator-template / SKILL.md Phase 2)

### Changed

- **validateHarness 공통 템플릿 목록 확장** — worklog·retro에 handoff 추가

## [1.4.0] - 2026-07-06

### Added

- **`retro` 스킬 (신규)** — 하네스 실행 산출물(워크로그·qa-report·이전 회고)을 근거로 잘된 점·반복 문제를 분석하고 에이전트 정의·스킬·오케스트레이터·description의 개선안을 도출하는 회고 스킬. 제안 → 승인 → 적용 원칙(자동 적용 금지), 근거 산출물 병기 의무, 이전 회고 대비 재발 추적, 적용 후 validateHarness 재검증 포함. "하네스는 진화하는 시스템" 원칙(Phase 4)의 실행 수단
- **회고 템플릿** (`skills/docs/assets/templates/retro.md`) — docs 스킬 템플릿 2종 체제(worklog + retro). 잘된 점 / 반복 문제 / 개선안(상태 추적 표: 제안→승인→적용/보류) / 적용 결과 4섹션
- **오케스트레이터 종료 절차에 회고 제안** — 생성되는 오케스트레이터 골격에 종료 단계(결과 보고 + 커밋 안내 + 회고 제안) 추가 (orchestrator-template / SKILL.md Phase 2·4)

### Changed

- **validateHarness 템플릿 검사 일반화** — worklog 단일 검사를 공통 템플릿 목록(worklog·retro) 순회로 확장. 템플릿별 개별 warn

## [1.3.0] - 2026-07-06

### Added

- **`docs` 스킬 (신규)** — 모든 작업을 공통 워크로그 템플릿(1.개요 / 2.작업내용 / 3.주의사항)으로 기록하는 두 번째 스킬. 템플릿은 `skills/docs/assets/templates/worklog.md` 실물 파일로 번들(훅과 같은 결정적 복사 방식). 단일 출처 규칙(프로젝트 사본 `docs/templates/worklog.md` 우선), 병렬 에이전트 파일 분리(`-{agent}` 접미사), 기존 기록 후속 갱신 절차, 시크릿 기록 금지 포함
- **하네스 워크로그 내장** — Phase 2에 템플릿 배포 단계(5) 추가: 생성되는 하네스의 `docs/templates/worklog.md`로 복사되고, 에이전트 정의·오케스트레이터에 "작업 완료 시 워크로그 기록" 규칙이 명시된다(절대 규칙 3의 기록 형식 구체화). agent-design / orchestrator-template / 산출물 체크리스트 반영
- **validateHarness 검사 1종 확장** — 하네스 존재 시 `docs/templates/worklog.md` 부재 warn. 테스트 17종 → 19종

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
