---
name: harness
description: "프로젝트 하네스의 설치·점검·업데이트·제거와 팀 설정을 관리한다. 분석 요청은 읽기만 수행한다."
---

# 프로젝트 설정 관리

분석·점검은 읽기와 보고만 한다. 설치·수정·업데이트 요청은 기존 설정을 조사하고 요청 범위에서 적용한다. 이미 승인된 가역적인 선택은 다시 묻지 않는다.

## 상태와 관리

프로젝트 지침, `.claude/settings.json`, `.codex/hooks.json`, `.agents/harness-install.json`과 팀 규칙을 확인한다. 실제 민감정보는 읽지 않는다.

```bash
node {이 스킬 경로}/scripts/validateHarness.mjs <프로젝트>
node {이 스킬 경로}/scripts/harnessManager.mjs status <프로젝트>
```

설치·업데이트·제거·복원에는 `references/installation.md`와 관리자 도구를 사용한다. 수동으로 관리 파일을 덮어쓰지 않는다. 미리보기 이후 파일이 달라지면 다시 계획하고, 출처 불명 파일과 사용자 수정본은 보존한다.

```bash
npx guksu-harness init <프로젝트> --app both
npx guksu-harness update <프로젝트> --dry-run
npx guksu-harness update <프로젝트>
```

| 구성 | 설치 내용 |
|---|---|
| `minimal` (새 설치 기본) | 공통 훅·코어 규칙·팀 규칙·앱 포인터. 기록 양식 없음 |
| `basic` (기존 이름 유지) | 최소 구성 + history·handoff 양식 |
| `collaboration` (선택) | basic + retro·loop-spec 양식. 에이전트를 자동 생성하지 않음 |

프로필은 양식 선택이며 기록 의무를 뜻하지 않는다. 기존 설치는 기록된 프로필을 유지하고 추적 기록에 프로필이 없으면 기존 basic으로 취급한다. 프로필을 낮춰도 기존 양식과 기록은 보존한다. 기록 요구는 팀 규칙과 훅 설정으로 정한다.

## 팀 고유 내용만 추가

- 팀 소유 `docs/harness-rules.md`에 기본값과 다른 브랜치·기록 정책, 검증 명령, 배포 조건을 적는다. 코어 사본은 직접 고치지 않는다.
- 규칙 파일은 포인터만 둔다. 일반적인 개발 순서나 매번 읽을 문서 목록을 추가하지 않는다.
- 도메인 스킬은 팀 고유 절차가 필요한 경우에만 만든다. `references/skill-authoring.md`를 참고한다.
- 여러 저장소의 설정 공유는 `references/team-customization.md`의 export/import를 사용한다.
- 기록·인계는 팀 정책 또는 사용자 요청이 있을 때만 해당 스킬을 사용한다.
- 프론트엔드 품질·배포 점검을 선택했다면 `references/frontend-domain.md`를 읽는다. UI 프로젝트라는 이유만으로 필수 연결하지 않는다.
- 명시적인 협업 구성에만 `references/execution-modes.md`, `references/agent-design.md`, `references/orchestrator-template.md`를 사용한다. 일반 재검사는 협업·loop 설정 없이 진행한다.
- 요구가 모호하거나 충돌하면 `references/design-dialogue.md`에 따라 필요한 결정만 묻는다. 결과 보고는 `references/plain-output.md`, 지침 크기 점검은 `references/context-economy.md`를 따른다.

## 확인과 제거

변경 후 구조 검사와 관련 회귀 검사를 실행한다. `references/testing-guide.md`는 코드 검사와 모델 평가를 구분한다. 훅 등록은 실제 앱 실행의 증거가 아니며 확인 범위는 `references/hooks-and-permissions.md`에 있다. `--ci`는 하네스 구조 검사만 설치한다.

제거는 관리 도구의 `plan --mode remove`로 진행한다. 관리 파일 참조를 먼저 정리하고 팀 설정·문서·기록은 보존한다. 도구 밖에서 만든 파일은 출처와 요청 범위를 확인한다. 코어 직접 수정은 `eject`로 팀 소유로 전환할 수 있다.
