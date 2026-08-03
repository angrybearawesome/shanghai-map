---
name: place
description: >
  상하이 지도에 장소를 추가/삭제/수정한다. 사용자가 "장소 추가", "장소 삭제",
  "카페 추가", "스팟 추가", "지도에 넣어줘", "지도에서 빼줘" 등을 말하면 이 스킬을 쓴다.
  좌표 리서치 → 카드 작성 → 렌더링 검증 → commit & push(자동 배포)까지 한 번에 처리한다.
---

# 장소 추가/삭제 스킬

이 프로젝트는 `public/index.html` 하나가 데이터이자 앱이다. `<main id="list">` 안의
`<article class="card">` 블록이 장소 원본이고, 핀·숫자·범례·푸터는 JS가 카드에서
자동 계산한다. **카드만 넣고 빼면 되고, 다른 곳은 절대 손대지 않는다.**

배포는 `main` push 시 Cloudflare Workers가 자동으로 한다 (약 30초).

## 요청 해석

- `/place 추가 <이름>` 또는 "장소 추가: <이름>" → 추가
- `/place 삭제 <번호|이름>` → 삭제
- 그룹이 명시 안 되면 판단: 커피/카페 → `cafe`, 그 외(관광지·식당·호텔·교통) → `spot`
- 지점이 여럿인 체인이면 기존 동선(와이탄·쉬후이 일대)에 가까운 지점을 고르되,
  선택했다는 사실과 대안을 반드시 보고에 남긴다

## 추가 절차

### 1. 리서치 (general-purpose 서브에이전트로 웹 검색)

반드시 확보할 것:
- 정식 중문 명칭 (간체) — `data-kw`에 들어간다. 고덕지도에서 검색되는 표기여야 함
- 중문 주소 (번지까지)
- **GCJ-02 좌표** (고덕지도 기준). WGS-84 원본과 변환 근거도 함께 받는다
- 실용 팁 1~3개 (가까운 지하철역, 영업시간, 함정 — 동명 장소, 입구 위치 등)

서브에이전트 프롬프트에 반드시 포함:
- "확실히 특정할 수 없으면 '불확실'이라고 말하라. 추측을 확실한 것처럼 보고하지 마라"
- "동명·유사 명칭 장소가 있는지 확인하라" (예: 建国宾馆 ≠ 建国铂萃, 십육포 1号≠3号 부두)
- 상하이 좌표 상식: 위도 30.7~31.6, 경도 120.9~122.0 (쑤저우는 120.6 부근)
- WGS-84→GCJ-02 상하이 오프셋: 대략 위도 −0.0021°, 경도 +0.0043°

### 2. 신뢰도 → 속성 매핑

| 리서치 결과 | 속성 |
|---|---|
| 독립 출처 2개 이상이 좌표 일치 | `data-fix="ok"` |
| 도로/블록 수준까지만 확인 | `data-fix="approx"` + 주소에 `<span class="flag">좌표 근사</span>` |
| 위치 특정 실패 | `data-fix="unknown" data-nopin="1"` + flag `지도 미표시 · 이름 검색`, 링크는 Apple 검색만 |
| 시내 중심(±0.15° 상자)에서 멀리 벗어남 (공항·쑤저우 등) | `data-far="1"` 추가 |

좌표가 지도 경계(BOUNDS: 위도 30.60~32.30, 경도 119.60~122.40) 밖이면 카드를 넣기 전에
사용자에게 알린다 — 핀이 이동 불가 영역에 떨어진다.

### 3. 카드 삽입

- `data-id`: 기존 최대 번호 +1, 두 자리 문자열 (`grep -o 'data-id="[0-9]*"' public/index.html`)
- 삽입 위치: cafe는 spot `grouphead` 앞, spot은 `</main>` 앞
- 템플릿 (README에도 있음):

```html
<article class="card" data-id="NN" data-group="cafe|spot" data-fix="ok"
         data-lat="31.xxxxxx" data-lon="121.xxxxxx" data-kw="중문상호">
  <div class="c-head"><div class="idx">NN</div>
    <div class="c-title"><h3 class="c-name">한글 이름 (中文/English)</h3><span class="c-tag">한줄 분류</span></div></div>
  <div class="addr-row"><div class="c-addr"><span class="a-txt">중문 주소</span></div></div>
  <p class="c-desc">설명. 함정·팁은 <b>굵게</b>.</p>
  <div class="links"><a href="#" data-act="search">이름으로 검색</a><a href="#" data-act="web">웹 지도</a><a href="#" data-act="apple">Apple 지도</a></div>
</article>
```

- 설명은 기존 카드 톤을 따른다: 존댓말 아님, 사실 위주 2~4문장, 함정을 먼저

## 삭제 절차

- 번호나 이름으로 해당 `<article>` 블록 전체(빈 줄 포함)를 제거
- 번호 재정렬은 하지 않는다 — 기존 번호는 방문 기록(localStorage)과 묶여 있음
- 삭제로 그룹 번호가 불연속이 되면 그룹 헤더가 자동으로 범위 대신 "N곳" 표기로 바뀜 (정상)

## 검증 (생략 금지)

1. 문법: `<script>` 블록을 `new Function()`으로 파싱해 JS 오류 없는지
2. 렌더링: 로컬 서버 + puppeteer-core(스크래치패드에 설치돼 있음, Chrome 경로
   `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`)로:
   - 카드 수·핀 수가 기대값과 일치 (핀 = 카드 − nopin)
   - 헤더 `N곳`, 탭, 범례 숫자가 채워짐 (`–`가 남아 있으면 실패)
   - 새 카드 클릭 시 지도 이동 + 팝업 열림
   - JS 오류 0건
3. 새 핀이면 스크린샷으로 지도 배경 위 위치가 그럴듯한지 눈으로 확인

## 커밋 & 배포

```
git add -A
git commit  # 메시지: "장소 추가: NN 이름 (중문)" 형식, 본문에 좌표 출처·선택 근거
git push
```

push 후 라이브 반영 확인 (보통 30초):
`curl -s "https://shanghai-map-202608.6011bear.workers.dev/?cb=$RANDOM" | grep -c 'data-id="NN"'`
15초 간격으로 최대 5분 폴링. 반영 안 되면 Cloudflare 대시보드 Deployments 확인을 안내.

## 보고

- 추가/삭제된 번호와 이름, 라이브 URL
- 좌표 신뢰도 (ok/approx/unknown)와 근거
- 지점 선택이나 동명 장소 같은 판단이 있었으면 그 내용
