---
name: harness
description: "프로젝트 작업 규칙 설정 — 하네스를 구축·점검·수정·업데이트·해체한다. '하네스 분석/점검/현황'은 읽기만 하고, '구축/수정/동기화/추가/제거'는 요청한 변경을 수행한다. 스킬·에이전트 구성과 기존 설정 보존, 상태 진단에 사용한다."
---

# 프로젝트 작업 규칙 설정

프로젝트에 맞는 작업 절차, 보호 장치, 기록 방식을 구성한다. 사용자가 이미 승인한 범위를 다시 확인하지 않고, 필요한 파일과 질문을 최소화한다.

## 요청 범위부터 구분한다

| 요청 | 수행 범위 |
|---|---|
| 분석·점검·감사·현황·개선안 | 읽기와 검사, 결과 보고만. 파일·브랜치·설정을 바꾸지 않는다 |
| 구축·설정 | 기존 규칙을 조사하고 필요한 구성을 만든다 |
| 수정·동기화·업데이트·추가 | 요청한 범위의 변경 미리보기를 만들고 적용한다 |
| 제거·해체 | 참조를 먼저 정리한 뒤 관리 파일을 제거한다. 사용자 기록은 보존한다 |

여러 의도가 섞이면 사용자에게 보이는 최종 요청을 따른다. “걷어낼 것이 있는지 분석”은 제거 요청이 아니다. “제안한 개선을 진행”은 그 개선의 구현 승인이다.

## 원칙

- **직접 실행이 기본이다.** 반복 실행 여부와 역할 분리 여부를 따로 판단한다. 테스트 재시도 때문에 에이전트 정의나 오케스트레이터(역할 간 진행표)를 만들지 않는다.
- **기존 프로젝트 정책을 따른다.** 브랜치 전략·기록 수준·검증 명령·권한을 새 기본값으로 덮어쓰지 않는다. 모델은 세션에서 상속한다.
- **승인은 범위로 판단한다.** 이미 승인한 작업과 가역적인 구현 선택은 진행한다. 외부 영향·권한 확대·미해결 요구사항만 질문한다. 알려진 사실은 파일에서 조사한다.
- **반복 설명을 줄인다.** 공통 작업 규칙은 `assets/harness-rules.md`에서 프로젝트 `.agents/harness-core-rules.md`(코어 사본, 관리 도구가 갱신)로 배포하고, 팀 규칙은 `docs/harness-rules.md`(팀 소유, 코어보다 우선)에 둔다. 다른 정의에는 두 파일의 포인터만 쓴다. 이 스킬에 규칙 전문을 복제하지 않는다.
- **보장 범위를 정확히 쓴다.** 훅은 등록된 도구 경로에서 실수를 줄인다. 모든 셸 우회를 막거나 사용자 승인을 판독하는 보안 경계는 아니다.

## 1. 현황 확인

1. 프로젝트의 규칙 파일(`CLAUDE.md`·`AGENTS.md`), 스킬 경로(`.claude/skills/`·`.agents/skills/`), `.claude/agents/`, 앱별 등록 파일(`.claude/settings.json`·`.codex/hooks.json`)과 기존 기록을 확인한다. 실제 민감정보 파일은 읽지 않는다. 현재 앱이 Claude Code인지 Codex인지도 확인한다.
2. 아래 두 검사를 실행한다. 구조 검사와 상태 진단은 파일을 수정하지 않는다.

```bash
node {이 스킬 경로}/scripts/validateHarness.mjs <프로젝트>
node {이 스킬 경로}/scripts/harnessManager.mjs status <프로젝트>
```

3. 현재 번들 버전과 설치 추적 버전을 구분한다. 추적 기록이 없으면 버전을 추측하지 않는다. 훅 등록과 실제 앱의 실행 지원 여부도 구분한다.
4. 분석·점검 요청이면 문제, 영향, 우선순위를 보고하고 종료한다. 수정까지 요청됐다면 아래 절차를 계속한다.

## 2. 필요한 구성 결정

기존 요청·설정에서 목표와 완료 기준을 확인한다. 기본 구성은 변경 목록과 선택 근거를 짧게 알리고 진행한다. 요구사항이 모호하거나 협업 구조가 복잡할 때만 `references/design-dialogue.md`에 따라 빠진 결정을 묻는다. 이미 승인된 설계는 다시 승인받지 않는다.

| 구성 | 사용하는 경우 | 만드는 것 |
|---|---|---|
| **기본** (`basic`, 이전 라이트) | 직접 실행, 단발 위임, 한 작업 안의 반복 | 도메인 스킬, 규칙 파일, 기본 훅·권한, history·handoff 템플릿, 규칙 파일(CLAUDE.md·AGENTS.md) 포인터 |
| **협업** (`collaboration`, 이전 풀) | 여러 역할이 실제로 지속 협업 | 기본 구성 + 필요한 에이전트 정의·진행표, retro·loop-spec 템플릿 |

검증 훅은 구성과 별개인 선택 기능이다. 장시간·정기 실행이 필요하면 `loop` 스킬을 사용한다. 상세 선택 기준은 `references/execution-modes.md`, 에이전트 정의는 `references/agent-design.md`를 따른다.

## 3. 변경 미리보기와 구축

번들 파일의 설치·업데이트·제거에는 `scripts/harnessManager.mjs`를 사용한다. 사용법과 관리 범위는 `references/installation.md`를 읽는다.

```bash
npx guksu-harness init <프로젝트> --app both        # 최초 설치 (미리보기만: --dry-run)
npx guksu-harness update <프로젝트>                 # 갱신
node {이 스킬 경로}/scripts/harnessManager.mjs plan <프로젝트> --out <계획.json>   # 세밀한 미리보기
node {이 스킬 경로}/scripts/harnessManager.mjs apply <프로젝트> --plan <계획.json>
```

팀이 무엇을 어디에 두어야 하는지 물으면 `references/team-customization.md`를 따른다. 파일 소유권: 코어 파일(훅·코어 규칙 사본)은 미수정일 때만 교체하고 수정본은 충돌로 보존한다. 팀이 의도적으로 고친 코어 파일은 `eject`로 소유를 전환한다. 문서 템플릿은 팀 수정본을 새 버전과 3-way 병합한다. 프로젝트 파일(팀 규칙·CLAUDE.md·AGENTS.md·CI 워크플로)은 없을 때 한 번만 만든다. 팀이 저장소 쪽 강제를 원하면 `--ci`로 검사 워크플로를 추가한다.

- `plan`은 추가·수정·충돌·보존 목록을 보여 준다. 프로젝트는 바꾸지 않는다. `--app claude|codex|both`로 등록할 앱을 고른다. 생략하면 프로젝트 파일로 추정한다.
- 적용은 저장된 계획이 현재 파일·번들과 일치할 때만 한다. 사용자 수정 파일과 출처가 불명확한 파일은 덮어쓰지 않는다.
- 사용자가 업데이트를 승인했다면 변경 목록을 설명하고 적용한다. 미리보기를 새 승인 의례로 만들지 않는다. 충돌은 내용 비교 후 요청 범위에서 해결하고, 결과를 바꾸는 미결정만 질문한다.
- 관리자 도구는 공통 훅·규칙·템플릿·앱별 훅 등록만 관리한다. 훅 파일은 앱 중립 위치 `.agents/hooks/`에 둔다. 도메인 스킬·에이전트·규칙 파일·검증 명령은 아래에서 별도로 구성한다.

추가 구성:

1. 프로젝트 스킬 경로에 필요한 도메인 절차를 `{name}/SKILL.md`로 작성한다. Claude Code는 `.claude/skills/`, Codex는 `.agents/skills/`를 읽는다. 두 앱을 함께 쓰면 한쪽에 두고 다른 쪽에 같은 내용을 복사한다(심볼릭 링크는 Windows에서 깨진다). 중복 스킬부터 확인하고, 본문은 500줄 이내로 유지한다 → `references/skill-authoring.md`.
2. 협업 구성이면 실제로 재사용할 역할 정의와 진행표만 만든다 → `references/orchestrator-template.md`.
3. 프로젝트의 보호 브랜치·커밋 허용·기록·작성자 표기 정책을 확인한다. 기존 설정은 보존하며 영구 권한 확대는 요청 범위에 포함됐을 때만 한다 → `references/hooks-and-permissions.md`.
4. 프론트엔드 프로젝트면 구현 중 `fe-craft`, 배포 전 `fe-predeploy`를 연결한다. 외부 라이브러리 연동은 `references/frontend-domain.md`를 따른다.
5. `_workspace/`, `.agents/harness-backups/`, `.agents/hooks/verifierGate.*.state.json`과 임시 파일을 `.gitignore`에 추가한다. 백업에는 설정 사본이 있으므로 커밋하지 않는다. `.agents/harness-base/`(템플릿 병합 원본)는 커밋한다.
6. 규칙 포인터 파일에는 목표·호출 조건·규칙 파일 포인터만 등록한다. Claude Code는 `CLAUDE.md`, Codex는 `AGENTS.md`를 읽는다. `init`이 없는 파일만 기본 포인터로 만들어 준다. 두 앱을 함께 쓰면 둘 다 두되 내용은 같게 유지한다. 작업 기록은 `history`로 한 건에 모으고 변경 이력을 여러 곳에 중복 작성하지 않는다.

## 4. 검증과 완료

1. 구조 검사를 다시 실행한다. 오류를 해결하고 경고는 적용 대상인지 확인한다.
2. 스크립트를 변경했으면 관련 회귀 테스트를 실행한다. 종료 훅은 개별 함수뿐 아니라 실제 이벤트 입력 순서도 검사한다.
3. `references/testing-guide.md`의 요청 시나리오로 읽기 전용 요청·작은 수정·업데이트 충돌·기록·업로드 범위를 확인한다. 모델 실행 평가와 문서 검사를 혼동하지 않는다. 훅이 실제 앱에서 동작하는지는 `references/hooks-and-permissions.md` §8의 절차로 사용자가 확인한다.
4. `references/plain-output.md`에 따라 결과·남은 실패·사용자 할 일을 짧게 보고한다.
5. 의미 있는 변경·커밋·PR 단위 기록은 `history` 스킬로 남긴다. 커밋·푸시는 요청받은 경우에만 `pr` 스킬로 진행한다.

## 해체

1. 요청한 대상을 참조하는 스킬·에이전트·규칙 파일(CLAUDE.md·AGENTS.md)을 역추적하고 참조부터 정리한다.
2. 관리 파일은 `plan --mode remove`로 미리보고 적용한다. 직접 수정한 파일이나 변경된 등록 항목은 충돌로 보존한다.
3. 도구 밖에서 생성한 도메인 정의는 생성 근거와 요청 범위를 확인해 제거한다. 사용자 기록과 기존 설정은 보존한다.
4. 구조 검사와 상태 진단으로 남은 참조를 확인한다. 기존 수동 설치의 출처를 확인할 수 없으면 임의 삭제하지 않고 목록을 보고한다.

## 참조

| 파일 | 필요한 때 |
|---|---|
| `references/installation.md` | 진단·미리보기·업데이트·제거·복원 |
| `references/team-customization.md` | 팀이 뼈대 위에 규칙·스킬·훅·양식을 얹는 법, 여러 저장소에 같은 설정 쓰기(export/import) |
| `references/hooks-and-permissions.md` | 훅별 설정과 한계, 앱(Claude Code·Codex)별 등록·확인 |
| `references/design-dialogue.md` | 빠진 요구사항 결정 |
| `references/execution-modes.md` | 실행 방식 선택 |
| `references/agent-design.md` | 독립 역할 정의 |
| `references/orchestrator-template.md` | 여러 역할의 진행표 작성 |
| `references/skill-authoring.md` | 스킬 작성·트리거 점검 |
| `references/frontend-domain.md` | 프론트엔드 연동 |
| `references/context-economy.md` | 문서와 컨텍스트 크기 조정 |
| `references/plain-output.md` | 쉬운 질문·결과 보고 |
| `references/testing-guide.md` | 검증과 실제 요청 시나리오 |
