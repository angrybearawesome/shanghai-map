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
  const outOfBounds = attrs.filter(a => {
    const lat = parseFloat((a.match(/data-lat="([\d.]+)"/) || [])[1]);
    const lon = parseFloat((a.match(/data-lon="([\d.]+)"/) || [])[1]);
    return !(lat >= BOUNDS.latMin && lat <= BOUNDS.latMax &&
             lon >= BOUNDS.lonMin && lon <= BOUNDS.lonMax);
  }).map((a, i) => (a.match(/data-id="(\d+)"/) || [])[1]);
  return { total: attrs.length, cafe, spot: attrs.length - cafe,
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
console.log(`\n[${MODE}] 카드 ${exp.total} (카페 ${exp.cafe} + 스팟 ${exp.spot}), 핀 기대 ${exp.pins}\n`);
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
check('탭 숫자', dom.tabs.join(',') === [exp.total, exp.cafe, exp.spot].join(','), dom.tabs.join(','));
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
check('JS 오류 없음', jsErrors.length === 0, jsErrors.slice(0, 2).join('; '));

const shot = path.join(ROOT, 'tools', 'last-verify.png');
await page.screenshot({ path: shot });
await browser.close();
if (server) server.close();

console.log(`\n스크린샷: ${shot}`);
console.log(fails.length ? `\n❌ 실패 ${fails.length}건: ${fails.join(' / ')}` : '\n✅ 전부 통과');
process.exit(fails.length ? 1 : 0);
