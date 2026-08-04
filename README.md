# 상하이 커피 지도

단일 HTML 파일로 된 개인용 지도. 외부 라이브러리·API 키 없음.

- 사이트: https://shanghai-map-202608.6011bear.workers.dev/
- 저장소: https://github.com/angrybearawesome/shanghai-map
- 배포: Cloudflare Workers 정적 assets (`main` push → 자동 빌드)

```
public/index.html   ← 지도 본체. 이 파일만 고치면 됨
wrangler.jsonc      ← 배포 설정 (건드릴 일 거의 없음)
tools/verify.mjs    ← 자동 검증 (npm run verify / verify:live)
.claude/skills/     ← Claude Code 명령어: /place /coords /verify
```

Claude Code 명령어:

| 명령 | 하는 일 |
|---|---|
| `/place 추가 <이름>` | 좌표 리서치 → 카드 작성 → 검증 → push까지 자동 |
| `/place 삭제 <번호>` | 카드 제거 (번호 재정렬 없음 — 방문 기록 보호) |
| `/coords 02` 또는 `전부` | 점선 핀·목록만 장소를 리서치해 확정 좌표로 승급 |
| `/verify` | 로컬·라이브 자동 점검 (숫자 검산, 팝업, JS 오류, 배포 최신 여부) |

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

**Claude Code를 쓰면**: `/place 추가 우캉맨션` 처럼 말하면 끝. 좌표 리서치부터
카드 작성·검증·push까지 자동으로 처리한다 (`.claude/skills/place/SKILL.md`).
삭제는 `/place 삭제 17`.

**손으로 하려면**: `public/index.html`에서 `<main id="list">` 안의 카드 한 덩이를 복사해 값만 바꿉니다.
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
| `data-group` | `cafe` / `spot` / `tea` | 색상(파랑/청록/자주)과 탭 분류 |
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

localStorage(`shcafemap.visits.v2`)에 방문 이벤트 목록 `[{id, ts}]`로 저장합니다.
**같은 곳을 다른 날 또 가면 이벤트가 한 줄 더 쌓입니다** (숙소처럼 매일 오가는 곳).
순번·루트는 매번 계산하므로 중간을 취소해도 번호가 자동으로 당겨집니다.

- 별 버튼은 '오늘' 기준 토글: 오늘 기록이 있으면 취소, 없으면 새 기록.
  잘못 누른 건 바로 다시 눌러 지우고, 지난 날 재방문은 그대로 쌓입니다.
- 재방문한 곳은 순번이 `3·9`처럼 병기됩니다 (카드·핀 동일).
- 지난 날 기록은 카드·팝업의 기록 줄에서 낱개로 취소합니다.
- 예전 v1(`{장소id: 시각}`) 데이터는 처음 열 때 자동으로 v2로 이관됩니다.
- 브라우저마다 따로 쌓이고, `file://`로 열면 저장이 안 되는 환경도 있습니다.

## 일일 루트

방문 기록을 날짜별로 묶어 만든 하루치 경로입니다. 별도 저장 없이 visits에서 매번 계산합니다.

- 방문한 날마다 기록 바 아래 `1일차 · 8/12` 칩이 생기고, 누르면 그날 방문 순서가
  지도에 점선으로 이어집니다. 루트에 없는 핀은 흐려지고, 칩 아래 걸음 목록이 나옵니다.
- `전체 루트`는 모든 날을 색을 바꿔가며 한 화면에 그립니다 (5색 순환).
- 점선은 방문 순서를 이은 직선일 뿐, 실제 도보·차량 경로가 아닙니다.
- 하루의 경계는 **새벽 4시**입니다. 자정 넘긴 술집 방문(00:40 등)은 전날 루트로 붙습니다.
- 지도에 핀이 없는 곳(`data-nopin`)은 걸음 목록에는 나오지만 선에서는 건너뜁니다.
- '복사' 버튼도 일차별로 묶어 내보냅니다.
