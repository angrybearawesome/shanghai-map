#!/usr/bin/env node
/* 지도 검증 스크립트
   사용법:  node tools/verify.mjs local   ← public/index.html을 로컬 서버로 띄워 검사
           node tools/verify.mjs live    ← 배포된 사이트를 검사 (+ 로컬 파일과 diff)
   Chrome 경로가 다르면 CHROME_PATH 환경변수로.                                  */
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODE = process.argv[2] || 'local';
const LIVE = 'https://shanghai-map-202608.6011bear.workers.dev/';
const CHROME = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BOUNDS = { latMin: 30.60, latMax: 32.30, lonMin: 119.60, lonMax: 122.40 };

const fails = [];
function check(name, ok, detail) {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? ` — ${detail}` : ''));
  if (!ok) fails.push(name);
}

/* ── 1. 원본 HTML에서 기대값 계산 (카드가 곧 데이터) ── */
function expectations(html) {
  const attrs = [...html.matchAll(/<article class="card"([^>]*)>/g)].map(m => m[1]);
  const ids = attrs.map(a => (a.match(/data-id="(\d+)"/) || [])[1]);
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  const nopin = attrs.filter(a => /data-nopin="1"/.test(a)).length;
  const cafe = attrs.filter(a => /data-group="cafe"/.test(a)).length;
  const tea = attrs.filter(a => /data-group="tea"/.test(a)).length;
  const outOfBounds = attrs.filter(a => {
    const lat = parseFloat((a.match(/data-lat="([\d.]+)"/) || [])[1]);
    const lon = parseFloat((a.match(/data-lon="([\d.]+)"/) || [])[1]);
    return !(lat >= BOUNDS.latMin && lat <= BOUNDS.latMax &&
             lon >= BOUNDS.lonMin && lon <= BOUNDS.lonMax);
  }).map((a, i) => (a.match(/data-id="(\d+)"/) || [])[1]);
  return { total: attrs.length, cafe, tea, spot: attrs.length - cafe - tea,
           nopin, pins: attrs.length - nopin, dup, outOfBounds, ids };
}

/* ── 2. 대상 HTML 확보 ── */
let url, srcHtml, server;
const localHtml = readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
if (MODE === 'live') {
  url = LIVE + '?cb=' + Math.random().toString(36).slice(2);
  // Node fetch는 사내 프록시 인증서에 걸릴 수 있어 curl(시스템 인증서 사용)로 받는다
  srcHtml = execFileSync('curl', ['-s', url], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  check('라이브 = 로컬 파일 (배포 최신 여부)', srcHtml === localHtml,
        srcHtml === localHtml ? '' : '다름 — push 전이거나 배포가 아직 안 돌았음');
} else {
  srcHtml = localHtml;
  server = http.createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(localHtml);
  }).listen(0);
  url = `http://127.0.0.1:${server.address().port}/`;
}
const exp = expectations(srcHtml);
console.log(`\n[${MODE}] 카드 ${exp.total} (카페 ${exp.cafe} + 스팟 ${exp.spot} + 차 ${exp.tea}), 핀 기대 ${exp.pins}\n`);
check('data-id 중복 없음', exp.dup.length === 0, exp.dup.join(','));
check('좌표가 지도 경계(BOUNDS) 안', exp.outOfBounds.length === 0, exp.outOfBounds.join(','));

/* ── 3. 실제 브라우저 렌더링 검사 ── */
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'shell', args: ['--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 900, deviceScaleFactor: 2 });
const jsErrors = [];
page.on('pageerror', e => jsErrors.push(e.message));
page.on('console', m => {
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
    jsErrors.push(m.text());
});
await page.goto(url, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 1200));

const dom = await page.evaluate(() => {
  const t = id => (document.getElementById(id) || {}).textContent;
  const firstPinned = document.querySelector('.card:not([data-nopin])');
  return {
    title: document.title,
    nAll: t('n-all'), total: t('n-total'), tipOff: t('t-off'),
    nOk: t('n-ok'), nEst: t('n-est'), nOff: t('n-off'),
    cards: document.querySelectorAll('.card').length,
    pins: document.querySelectorAll('.pin').length,
    tabs: [...document.querySelectorAll('#tabs button b')].map(b => b.textContent),
    dashLeft: [...document.querySelectorAll('#tabs b, .legend b, header b')]
      .some(b => b.textContent.trim() === '–'),
    firstPinnedId: firstPinned ? firstPinned.dataset.id : null,
  };
});
check('카드 수 일치', dom.cards === exp.total, `${dom.cards}/${exp.total}`);
check('핀 수 = 카드 − nopin', dom.pins === exp.pins, `${dom.pins}/${exp.pins}`);
check('헤더 N곳 채워짐', dom.nAll === String(exp.total), dom.nAll);
check('안내문 N곳 채워짐', dom.tipOff === String(exp.nopin), dom.tipOff);
check('탭 숫자', dom.tabs.join(',') === [exp.total, exp.cafe, exp.spot, exp.tea].join(','), dom.tabs.join(','));
check('범례 합계 = 전체',
      Number(dom.nOk) + Number(dom.nEst) + Number(dom.nOff) === exp.total,
      `${dom.nOk}+${dom.nEst}+${dom.nOff}`);
check("숫자에 '–' 잔재 없음", !dom.dashLeft);

/* 카드 클릭 → 팝업 열림 */
if (dom.firstPinnedId) {
  await page.evaluate(id =>
    document.querySelector(`.card[data-id="${id}"]`).click(), dom.firstPinnedId);
  await new Promise(r => setTimeout(r, 900));
  const popFor = await page.evaluate(() =>
    (document.querySelector('.pop') || { dataset: {} }).dataset.for);
  check('카드 클릭 → 팝업', popFor === dom.firstPinnedId, `pop=${popFor}`);
}
/* ── 4. 방문 기록·일일 루트 스모크 (이틀치 + 재방문 주입) ── */
await page.evaluate(() => {
  const day = 86400e3, base = new Date(); base.setHours(12, 0, 0, 0);
  const t = +base;
  localStorage.setItem('shcafemap.visits.v2', JSON.stringify([
    { id: '01', ts: t - day - 2 * 3600e3 },
    { id: '13', ts: t - day + 9 * 3600e3 },
    { id: '01', ts: t - 3600e3 },            // 재방문
    { id: '12', ts: t },
  ]));
});
await page.reload({ waitUntil: 'load' });
await new Promise(r => setTimeout(r, 900));
await page.evaluate(() => document.querySelector('.rday[data-day]').click());
await new Promise(r => setTimeout(r, 800));
const rt = await page.evaluate(() => ({
  chips: document.querySelectorAll('.rday').length,
  paths: document.querySelectorAll('#routes path').length,
  badge: (document.querySelector('.card[data-id="01"] .star .ord') || {}).textContent,
  rows: document.querySelectorAll('.card[data-id="01"] .vlist span').length,
}));
check('루트: 일차 칩 (2일+전체)', rt.chips === 3, String(rt.chips));
check('루트: 선 그려짐', rt.paths === 1, String(rt.paths));
check('재방문: 순번 병기', /·/.test(rt.badge || ''), rt.badge);
check('재방문: 기록 줄 2개', rt.rows === 2, String(rt.rows));
await page.evaluate(() => localStorage.clear());

/* ── 5. 여행 계획 스모크 (일차 2 + 자동 추정 + 수동 구간 + 동선) ── */
await page.evaluate(() => {
  localStorage.setItem('shcafemap.plan.v1', JSON.stringify({ days: [
    { stops: [
      { time: '10:00', name: '건국 보취 호텔 (建国铂萃 · 난징루 보행가)',
        placeId: '15', lat: 31.232507, lon: 121.477803, leg: null },
      { time: '11:00', name: '십육포 부두 (十六铺码头)',
        placeId: '16', lat: 31.228588, lon: 121.498233, leg: { min: 150, mode: '항공기' } },
      { time: '14:00', name: '인천공항', placeId: null, lat: null, lon: null, leg: null },
    ] },
    { stops: [] },
  ] }));
});
await page.reload({ waitUntil: 'load' });
await new Promise(r => setTimeout(r, 900));
await page.evaluate(() => document.querySelector('#views button[data-v="plan"]').click());
await new Promise(r => setTimeout(r, 300));
const pl = await page.evaluate(() => ({
  planVisible: getComputedStyle(document.getElementById('plan')).display !== 'none',
  days: document.querySelectorAll('.pday').length,
  stops: document.querySelectorAll('.pstop').length,
  legs: document.querySelectorAll('.pleg').length,
  autoTxt: (document.querySelector('.pleg .pl-txt') || {}).textContent || '',
  manualTxt: [...document.querySelectorAll('.pleg .pl-txt')].map(x => x.textContent).join(' | '),
}));
await page.evaluate(() => document.querySelector('.pd-act button[data-pact="route"]').click());
await new Promise(r => setTimeout(r, 500));
const planPaths = await page.evaluate(() =>
  document.querySelectorAll('#routes path.plan').length);
check('계획: 화면 전환', pl.planVisible);
check('계획: 일차 2 · 스톱 3 · 구간 2',
      pl.days === 2 && pl.stops === 3 && pl.legs === 2, `${pl.days}/${pl.stops}/${pl.legs}`);
check('계획: 구간 자동 추정 (거리+교통편)', /(km|m)/.test(pl.autoTxt) && /택시/.test(pl.autoTxt), pl.autoTxt.slice(0, 50));
check('계획: 수동 구간 우선', /직접 입력/.test(pl.manualTxt) && /항공기/.test(pl.manualTxt), pl.manualTxt.slice(0, 80));
check('계획: 동선 선 그려짐', planPaths === 1, String(planPaths));
/* 장소 입력칸 포커스 → 선택 패널. 이미 값이 있어도 전체 목록이 나와야 한다 */
const psel = await page.evaluate(() => {
  const inp = document.querySelector('.ps-place');
  inp.focus();
  const all = document.querySelectorAll('.psel button[data-pick]').length;
  inp.value = '커피';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  const filtered = document.querySelectorAll('.psel button[data-pick]').length;
  inp.blur();
  return { all, filtered };
});
check('계획: 장소 패널 전체 목록', psel.all === exp.total, `${psel.all}/${exp.total}`);
check('계획: 장소 패널 검색 필터', psel.filtered > 0 && psel.filtered < psel.all, String(psel.filtered));
/* 분류 탭: '차' 탭을 누르면 tea 그룹만 보이고, '전체'로 돌아오면 원복 */
const ptab = await page.evaluate(() => {
  const inp = document.querySelector('.ps-place');
  inp.value = ''; inp.focus(); inp.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('.psel [data-pgroup="tea"]')
    .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  const tea = document.querySelectorAll('.psel button[data-pick]').length;
  document.querySelector('.psel [data-pgroup="all"]')
    .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  const all = document.querySelectorAll('.psel button[data-pick]').length;
  inp.blur();
  return { tea, all };
});
check('계획: 장소 패널 분류 탭', ptab.tea === exp.tea && ptab.all === exp.total,
      `차 ${ptab.tea}/${exp.tea} · 전체 ${ptab.all}/${exp.total}`);
/* 일차 ↑↓ 이동: 순서가 바뀌고 번호는 위치에서 자동 재계산 (검사 후 원복) */
const dmove = await page.evaluate(() => {
  document.querySelector('.pday[data-di="0"] button[data-pact="daydown"]').click();
  const days = [...document.querySelectorAll('.pday')];
  const out = {
    labels: days.map(d => d.querySelector('h2').textContent).join(','),
    stops0: days[0].querySelectorAll('.pstop').length,
    stops1: days[1].querySelectorAll('.pstop').length,
  };
  document.querySelector('.pday[data-di="1"] button[data-pact="dayup"]').click();  // 원복
  return out;
});
check('계획: 일차 이동 + 자동 재번호',
      dmove.labels === '1일차,2일차' && dmove.stops0 === 0 && dmove.stops1 === 3,
      JSON.stringify(dmove));

/* ── 6. 계획 공유 링크 왕복 (링크 생성 → 새 방문자로 열기 → 추가 확인) ── */
const shareUrl = await page.evaluate(() => {
  if (navigator.clipboard) navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); };
  document.querySelector('button[data-pact="shareplan"]').click();
  return window.__copied;
});
check('공유: 링크 생성', typeof shareUrl === 'string' && shareUrl.includes('#plan='),
      `${(shareUrl || '').length}자 · ${(shareUrl || '').slice(0, 60)}…`);
await page.evaluate(() => localStorage.clear());          // 링크를 받은 친구 입장
const onDialog = d => d.accept(d.type() === 'prompt' ? '철수' : undefined);
page.on('dialog', onDialog);                              // confirm 수락 + 이름 프롬프트에 '철수'
await page.goto('about:blank');
await page.goto(shareUrl, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 900));
const imp = await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('shcafemap.plan.v1') || '{"days":[]}');
  const st = (p.days[0] || { stops: [] }).stops;
  return {
    days: p.days.length, stops: st.length,
    linked: st[0] && st[0].placeId === '15' && typeof st[0].lat === 'number',
    leg: st[1] && st[1].leg && st[1].leg.min === 150,
    src: (p.days[0] || {}).src || '',
    tagShown: !!document.querySelector('.pday.shared .pd-src'),
    planview: document.body.classList.contains('planview'),
    hashCleared: !location.hash.includes('plan='),
  };
});
check('공유: 가져오기 (2일차·3곳·장소 복원·수동 구간)',
      imp.days === 2 && imp.stops === 3 && imp.linked && imp.leg,
      JSON.stringify(imp));
check('공유: 출처 태그 (보낸 사람·날짜)', /^철수 · \d+\/\d+$/.test(imp.src) && imp.tagShown, imp.src);
check('공유: 계획 화면 전환 + 해시 정리', imp.planview && imp.hashCleared);
await page.evaluate(() => localStorage.clear());
/* 초기(v1 JSON) 링크도 계속 열려야 한다 */
const v1url = await page.evaluate(() =>
  location.href.split('#')[0] + '#plan=' +
  btoa(unescape(encodeURIComponent(JSON.stringify({ v: 1, d: [[{ t: '09:00', i: '10' }]] }))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
await page.goto('about:blank');
await page.goto(v1url, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, 900));
const v1 = await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('shcafemap.plan.v1') || '{"days":[]}');
  const st = (p.days[0] || { stops: [] }).stops[0] || {};
  return { days: p.days.length, id: st.placeId };
});
check('공유: v1 링크 하위 호환', v1.days === 1 && v1.id === '10', JSON.stringify(v1));
page.off('dialog', onDialog);
await page.evaluate(() => localStorage.clear());

check('JS 오류 없음', jsErrors.length === 0, jsErrors.slice(0, 2).join('; '));

const shot = path.join(ROOT, 'tools', 'last-verify.png');
await page.screenshot({ path: shot });
await browser.close();
if (server) server.close();

console.log(`\n스크린샷: ${shot}`);
console.log(fails.length ? `\n❌ 실패 ${fails.length}건: ${fails.join(' / ')}` : '\n✅ 전부 통과');
process.exit(fails.length ? 1 : 0);
