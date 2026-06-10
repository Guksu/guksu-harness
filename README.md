# guksu-harness

> Guksu의 하네스 아키텍트 — 도메인 요청을 **에이전트(누가) + 스킬(어떻게) + 오케스트레이션(언제, 어떤 순서로)**으로 변환하는 Claude Code 메타 스킬.

기존 하네스 팩토리 계열 플러그인이 에이전트 팀만을 전제하던 시절의 설계라, 현 시점의 Claude Code 프리미티브(Workflow 결정적 오케스트레이션, 스키마 강제 출력, 세션 모델 상속)를 반영해 처음부터 다시 만들었다.

## 무엇이 다른가

| 영역 | 기존 하네스 플러그인 | guksu-harness |
|------|--------------------|---------------|
| 실행 모드 | 에이전트 팀이 무조건 기본 | **작업 형태가 결정** — 결정적 흐름은 Workflow, 피드백 루프는 팀, 단발 위임은 서브 에이전트 |
| Workflow 도구 | 미지원 | **1급 실행 모드** — pipeline/parallel, 스키마 검증 출력, 토큰 버짓 |
| 모델 정책 | `model: "opus"` 하드코딩 | **세션 모델 상속이 기본** — 모델 세대가 바뀌어도 하네스가 늙지 않는다 |
| 작업 스타일 | 없음 | **절대 규칙 내장** — TDD 기본, git 사용자 전담, 경계면 교차검증 QA, 파일 기반 산출물 |
| 본문 크기 | SKILL.md 458줄 | **124줄** — 세부는 references/ 5종으로 분리 (Progressive Disclosure) |
| 구조 검증 | 수동 체크리스트 | **`validateHarness.mjs`** — frontmatter·참조 링크·버전 정합성 자동 검사 (테스트 포함) |

## 설치

```
/plugin marketplace add Guksu/guksu-harness
/plugin install guksu-harness@guksu-harness
```

기존 하네스 플러그인을 쓰고 있었다면 트리거 충돌을 피하기 위해 제거한다:

```
/plugin uninstall harness@harness-marketplace
```

## 사용

```
> 이 프로젝트에 하네스 구축해줘
> 하네스 점검해줘 / 에이전트·스킬 동기화해줘
> QA 에이전트 추가해줘
```

스킬이 트리거되면 **감사 → 설계 → 구축 → 검증 → 등록·진화**의 5단계로 진행하며, 결과물로 프로젝트에 `.claude/agents/`, `.claude/skills/`, 오케스트레이터 스킬, CLAUDE.md 포인터가 생성된다.

## 생성되는 모든 하네스에 내장되는 절대 규칙

1. **git 작업은 사용자 전담** — 에이전트는 commit·push 등 git 명령을 절대 수행하지 않는다.
2. **코드 생성 하네스는 TDD 기본** — 인수조건 = 테스트 케이스 (Red→Green→Refactor).
3. **산출물은 파일 기반** — 중간 산출물 보존, 감사 추적 가능.
4. **단일 출처 문서 준수** — 설계·컨벤션 문서와 어긋나면 사용자에게 확인.
5. **QA는 경계면 교차검증 + incremental** — 생산자↔소비자 shape 비교, 모듈 완성 직후마다.

## 구조

```
guksu-harness/
├── .claude-plugin/
│   ├── marketplace.json
│   └── plugin.json
└── skills/harness/
    ├── SKILL.md                      # 핵심 워크플로우 (5 Phase)
    ├── references/
    │   ├── execution-modes.md        # Workflow·팀·서브 에이전트 결정 트리 (핵심)
    │   ├── agent-design.md           # 분리 기준 4축, 정의 템플릿, QA 가이드
    │   ├── skill-authoring.md        # description 트리거, progressive disclosure
    │   ├── orchestrator-template.md  # 모드별 골격, 데이터 전달, 에러 핸들링
    │   └── testing-guide.md          # 구조·트리거·실행 테스트
    └── scripts/
        ├── validateHarness.mjs       # 하네스 구조 검증기
        └── validateHarness.test.mjs
```

## 개발

```bash
# 검증기 테스트
node --test skills/harness/scripts/validateHarness.test.mjs

# 이 repo 자체를 검증 (셀프 호스팅 — 하네스가 자기 규칙을 통과해야 한다)
node skills/harness/scripts/validateHarness.mjs .
```

## License

MIT © Guksu
