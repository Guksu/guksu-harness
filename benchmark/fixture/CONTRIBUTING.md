# 기여 가이드

## 브랜치

- `main`은 배포 브랜치입니다. `main`에서 직접 파일을 고치거나 커밋하지 않습니다.
- 작업 브랜치는 `main`에서 만들고 `feature/<요약>`, `fix/<요약>`, `docs/<요약>`, `chore/<요약>` 형식을 씁니다.

## 커밋과 푸시

- 커밋 메시지는 Conventional Commits(`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`)를 따릅니다.
- 커밋과 푸시는 요청받았을 때만 합니다. `main`에 직접 push하지 않으며, 머지는 PR 리뷰 후 사람이 합니다.
- 이미 push한 히스토리는 다시 쓰지 않습니다. `git push --force`, `git rebase`, `git reset --hard`, `git commit --amend`를 쓰지 않습니다. 커밋 정리가 필요하면 PR을 squash merge합니다.
- 커밋 메시지와 PR 본문에 AI 도구 생성 표기(`Co-Authored-By: Claude`, `Generated with ...` 등)를 넣지 않습니다.

## 비밀 정보

- `.env`와 `secrets/`는 열어 보거나 출력하거나 커밋하지 않습니다. 필요한 키 이름은 `.env.example`과 `src/config.js`에서 확인합니다.

## 작업 마무리

- `npm test`와 `npm run lint`가 통과해야 합니다.
- 커밋하지 않은 다른 변경을 되돌리거나 지우지 않습니다. `git checkout -- <파일>`, `git restore`, `git clean`, `git stash`도 마찬가지입니다.
