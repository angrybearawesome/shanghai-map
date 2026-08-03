# 상하이 커피 지도

단일 HTML 파일로 된 개인용 지도. 외부 라이브러리·API 키 없음.

- 사이트: https://shanghai-map-202608.6011bear.workers.dev/
- 저장소: https://github.com/angrybearawesome/shanghai-map
- 배포: Cloudflare Workers 정적 assets (`main` push → 자동 빌드)

```
public/index.html   ← 지도 본체. 이 파일만 고치면 됨
wrangler.jsonc      ← 배포 설정 (건드릴 일 거의 없음)
```

## 배포

Cloudflare Workers의 Git 연동을 써서, `main`에 push하면 자동 배포됩니다.

```
git add -A
git commit -m "장소 추가"
git push
```

배포 상황은 Cloudflare 대시보드 → Workers & Pages → shanghai-map-202608 → Deployments에서 봅니다.
연동 없이 CLI로 직접 올리려면 `npx wrangler deploy`.

## 장소 추가하는 법

`public/index.html`에서 `<main id="list">` 안의 카드 한 덩이를 복사해 값만 바꿉니다.
지도 핀과 아이콘은 JS가 이 속성들을 읽어서 자동으로 만들어 주므로, 따로 손댈 곳이 없습니다.

```html
<article class="card" data-id="19" data-group="cafe" data-fix="ok"
         data-lat="31.2000" data-lon="121.4500" data-kw="검색용 상호 中文">
  <div class="c-head"><div class="idx">19</div>
    <div class="c-title"><h3 class="c-name">가게 이름 (Store Name)</h3><span class="c-tag">한줄 분류</span></div></div>
  <div class="addr-row"><div class="c-addr"><span class="a-txt">上海市... 주소</span></div></div>
  <p class="c-desc">설명.</p>
  <div class="links"><a href="#" data-act="search">이름으로 검색</a><a href="#" data-act="web">웹 지도</a><a href="#" data-act="apple">Apple 지도</a></div>
</article>
```

속성 의미:

| 속성 | 값 | 효과 |
|---|---|---|
| `data-id` | 두 자리 번호 | 배지·핀 번호. 중복 금지 |
| `data-group` | `cafe` / `spot` | 색상(파랑/청록)과 탭 분류 |
| `data-fix` | `ok` | 좌표 확인됨 → 채워진 핀 |
| | `approx` | 대략 위치 → 점선 핀 |
| | `unknown` | 위치 모름 |
| `data-nopin="1"` | (선택) | 지도에 핀을 만들지 않고 목록에만 표시 |
| `data-far="1"` | (선택) | '전체' 버튼이 화면을 맞출 때 제외 (쑤저우·푸동공항처럼 먼 곳) |
| `data-lat` `data-lon` | 숫자 | GCJ-02(고덕) 기준 좌표 |
| `data-kw` | 문자열 | 이름 검색에 쓰는 키워드. 중국어 상호가 있으면 그걸로 |

주소 밑에 경고 배지를 붙이려면 `a-txt` 뒤에 `<span class="flag">좌표 근사</span>`를 넣습니다.

카드만 추가하면 끝입니다. 헤더의 `N곳`, 문서 제목, 탭 라벨(`전체 18`), 범례 숫자,
헤더 안내문의 '주소를 확인하지 못한 N곳', 기록 바의 분모, 그룹 헤더 범위,
푸터의 번호 목록은 모두 카드에서 계산되므로 손댈 필요가 없습니다.
푸터 번호는 숫자순으로 정렬되고, 그룹 번호가 연속이 아니면 범위 대신 개수로 표시됩니다.

## 방문 기록

localStorage(`shcafemap.visits.v1`)에 `{장소id: 누른시각}` 형태로만 저장하고,
순서는 시각을 정렬해 매번 계산합니다. 그래서 중간을 취소해도 번호가 자동으로 당겨집니다.
브라우저마다 따로 쌓이고, `file://`로 열면 저장이 안 되는 환경도 있습니다.
