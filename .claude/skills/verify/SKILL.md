---
name: verify
description: >
  지도를 자동 검증한다. 사용자가 "검증", "확인해줘", "배포 잘 됐어?",
  "사이트 멀쩡해?", "깨진 거 없어?" 등을 말하거나, 지도 코드를 수정한 뒤
  배포 전 점검이 필요할 때 쓴다. 로컬 파일과 라이브 사이트 양쪽을 검사한다.
---

# 지도 검증 스킬

검증 로직은 전부 `tools/verify.mjs` 에 있다. 새 검사 코드를 즉석에서 짜지 말고
이 스크립트를 실행한다. 검사 항목을 늘리고 싶으면 이 파일을 고쳐서 커밋한다.

## 실행

```bash
node tools/verify.mjs local    # 작업 중인 public/index.html 검사 (push 전)
node tools/verify.mjs live     # 배포된 사이트 검사 (push 후)
```

`npm run verify` / `npm run verify:live` 도 같다.

- 의존성이 없다는 오류가 나면: `npm install` (puppeteer-core는 devDependency로 고정돼 있음)
- Chrome 경로가 다른 환경이면: `CHROME_PATH=<경로> node tools/verify.mjs ...`

## 무엇을 검사하나

- 원본 HTML의 카드에서 기대값을 계산해 실제 렌더링과 대조:
  카드 수, 핀 수(=카드−nopin), 헤더 `N곳`, 안내문 N곳, 탭, 범례 합계
- `data-id` 중복, 좌표가 지도 경계(BOUNDS) 밖인 카드
- 숫자에 `–` 잔재 (초기화 실패 감지)
- 카드 클릭 → 팝업 열림, JS 오류 0건
- `live` 모드는 배포본이 로컬 파일과 바이트 단위로 같은지도 확인
  (다르면 push 전이거나 배포가 아직 안 돈 것)

스크린샷이 `tools/last-verify.png` 에 남는다 (gitignore 됨).
문제가 보이면 스크린샷을 Read로 열어 눈으로도 확인할 것.

## 판정

- exit 0 + `✅ 전부 통과` → 정상
- 실패가 있으면 어떤 검사가 왜 깨졌는지 사용자에게 보고하고, 원인을 고친 뒤 재실행
- push 직후 `live` 가 "라이브 = 로컬 파일" 에서 실패하면 배포 지연일 수 있다 —
  15초 간격으로 2~3번 재시도 후에도 다르면 Cloudflare 대시보드 Deployments 확인 안내
