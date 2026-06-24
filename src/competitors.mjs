// competitors.mjs — Data 계층: 경쟁사 크롤(토큰 없이) + competitors-cache.json 누적 + 번역 캐시
//
// 의존성 0 — Node 22 내장 fetch + curl(child_process) 만 사용. npm/CDN 금지.
// 핵심 원칙: 실패해도 캐시는 절대 날리지 않는다(누적 보존). 부분 성공도 캐시에 합친다.
//
// 두 소스(검증된 방법 그대로):
//   X(트위터, 토큰X) : syndication.twitter.com/srv/timeline-profile/screen-name/{h}
//                      → HTML 내 <script id="__NEXT_DATA__"> JSON
//                      → props.pageProps.timeline.entries 중 type=='tweet'
//                      → content.tweet = { full_text, favorite_count, retweet_count, reply_count, created_at }
//   Threads(토큰X)   : r.jina.ai 로 www.threads.net/@{h} 마크다운 변환 → 글 텍스트 추출
//                      (좋아요/답글은 불안정 → 본문·소재 위주)
//
// 각 글 저장 스키마: { account, platform, lang, text, likes, reshares, timestamp, url }
// 번역 캐시: 각 경쟁사 상위 5개(참여순)만 text_ko(한국어 번역+1줄요약). 나머지는 비움.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_FILE = join(ROOT, "competitors-cache.json");

// ───────────────────────── 크롤 대상(워치리스트) ─────────────────────────
// competitors.json (gitignore) 가 있으면 그걸 쓰고, 없으면 competitors.example.json, 둘 다 없으면 빈 목록.
// x = 해외(번역 대상) / threads = 국내 같은 플랫폼 직접 비교.  각 항목: { handle, lang }
const DEFAULT_COMPETITORS = { x: [], threads: [] };
function loadCompetitorsConfig() {
  for (const name of ["competitors.json", "competitors.example.json"]) {
    const f = join(ROOT, name);
    if (existsSync(f)) {
      try {
        const cfg = JSON.parse(readFileSync(f, "utf8"));
        return { x: Array.isArray(cfg.x) ? cfg.x : [], threads: Array.isArray(cfg.threads) ? cfg.threads : [] };
      } catch { /* 다음 후보 */ }
    }
  }
  return DEFAULT_COMPETITORS;
}
export const COMPETITORS = loadCompetitorsConfig();

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// curl 래퍼(execFile → 셸 인젝션 없음). 실패 시 빈 문자열 반환(throw 안 함 → 캐시 보존 우선).
function curl(args, timeoutMs = 45000) {
  return new Promise((resolve) => {
    execFile("curl", args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? (stdout || "") : (stdout || ""));
    });
  });
}

// ───────────────────────── X(트위터) 크롤 ─────────────────────────
// syndication 엔드포인트 → __NEXT_DATA__ JSON → timeline.entries[type==tweet].content.tweet
export async function fetchXTimeline(handle, lang) {
  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(handle)}`;
  const html = await curl(["-sL", url, "-H", `User-Agent: ${UA}`, "-H", "Accept: text/html,application/xhtml+xml", "--max-time", "30"], 35000);
  if (!html || /Rate limit exceeded/i.test(html)) {
    return { ok: false, reason: html ? "rate-limited" : "empty", posts: [] };
  }
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return { ok: false, reason: "no __NEXT_DATA__", posts: [] };

  let data;
  try { data = JSON.parse(m[1]); } catch { return { ok: false, reason: "json parse fail", posts: [] }; }

  const entries = data?.props?.pageProps?.timeline?.entries || [];
  const posts = [];
  for (const e of entries) {
    if (e?.type !== "tweet") continue;
    const t = e.content?.tweet;
    if (!t) continue;
    const text = (t.full_text || t.text || "").trim();
    if (!text) continue;
    const likes = t.favorite_count ?? 0;
    const reshares = (t.retweet_count ?? 0) + (t.quote_count ?? 0);
    posts.push({
      account: handle,
      platform: "x",
      lang,
      text,
      likes,
      reshares,
      replies: t.reply_count ?? 0,
      timestamp: t.created_at ? new Date(t.created_at).toISOString() : null,
      url: t.id_str ? `https://x.com/${handle}/status/${t.id_str}` : `https://x.com/${handle}`,
    });
  }
  return { ok: posts.length > 0, reason: posts.length ? "" : "no tweets", posts };
}

// ───────────────────────── Threads 크롤 ─────────────────────────
// r.jina.ai 마크다운 → 글 블록 파싱. 좋아요/답글은 불안정하지만 가능한 한 추출(끝의 숫자 4개).
// 마크다운 패턴(관찰):
//   [핸들](.../@핸들)
//   [1h|3h|2d](.../post/POSTID)   ← 시간 + permalink
//   <본문 여러 줄>
//   Translate                      ← 본문 끝 마커
//   ...이미지/Learn more...
//   likes\nreplies\nreposts\nshares  ← 끝 숫자 4개(있을 때만)
export async function fetchThreadsTimeline(handle, lang) {
  const url = `https://r.jina.ai/https://www.threads.net/@${encodeURIComponent(handle)}`;
  const md = await curl(["-s", url, "-H", `User-Agent: ${UA}`, "--max-time", "40"], 50000);
  if (!md || md.length < 200) return { ok: false, reason: "empty/short", posts: [] };

  const posts = parseThreadsMarkdown(md, handle, lang);
  return { ok: posts.length > 0, reason: posts.length ? "" : "no posts parsed", posts };
}

// permalink 라인 [라벨](.../post/POSTID) 을 글 경계로 사용해 분절.
// 라벨 포맷은 다양함: "1h", "3d", "12/25/25"(MM/DD/YY), "20h" 등 → URL 의 /post/ 만으로 매칭.
function parseThreadsMarkdown(md, handle, lang) {
  const lines = md.split(/\r?\n/);
  // post permalink 라인 인덱스 수집 (라벨 포맷 무관하게 /post/ URL 로 식별)
  const postRe = /\[([^\]]*)\]\((https?:\/\/[^)]*\/post\/[A-Za-z0-9_-]+)\)/;
  const boundaries = [];
  const seenUrl = new Set();
  for (let i = 0; i < lines.length; i++) {
    const mm = lines[i].match(postRe);
    if (mm && !seenUrl.has(mm[2])) {
      seenUrl.add(mm[2]);
      boundaries.push({ i, time: mm[1], url: mm[2] });
    }
  }
  if (!boundaries.length) return [];

  const posts = [];
  for (let b = 0; b < boundaries.length; b++) {
    const start = boundaries[b].i + 1;
    const end = b + 1 < boundaries.length ? boundaries[b + 1].i : lines.length;
    const block = lines.slice(start, end);

    // 본문 = permalink 이후 ~ "Translate" 마커(없으면 첫 이미지/링크 전까지)
    // 본문이 어디서 끝나는지(bodyEnd) 기록 → 그 뒤의 footer 숫자만 참여수로 인정.
    const textLines = [];
    let bodyEnd = block.length;
    for (let k = 0; k < block.length; k++) {
      const ln = block[k].trim();
      if (ln === "Translate") { bodyEnd = k; break; }
      if (/^!\[/.test(ln)) { bodyEnd = k; break; } // 이미지 만나면 본문 끝
      if (/^\[[^\]]*\]\(https?:\/\//.test(ln)) continue; // 순수 링크 라인 스킵
      if (/^(Follow|Mention|Reply|Repost|Like|Share|Translate|Learn more|Sorry, we're having trouble)/i.test(ln)) continue;
      if (!ln) continue;
      textLines.push(block[k].trim());
    }

    // footer 숫자 = bodyEnd 이후 영역의 "단독 숫자 라인"들(빈 줄·이미지·Learn more 로 구분됨).
    // 본문 안 숫자는 bodyEnd 이전이라 자동 제외 → "직원 0명/100개" 같은 본문 수치 오인 없음.
    // Threads 카운트 막대 = [likes, replies, reposts, shares] 순서로 각자 한 줄. 앞 4개 채택.
    const afterBody = block.slice(bodyEnd).map((s) => s.trim());
    const numLines = afterBody
      .filter((ln) => /^\d[\d,]*$/.test(ln))
      .map((ln) => parseInt(ln.replace(/,/g, ""), 10));
    // 4개 미만이면 불안정(좋아요 0인 글은 막대가 안 뜨기도 함) → null 처리.
    const trailingNums = numLines.length >= 4 ? numLines.slice(0, 4) : [];

    const text = textLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!text || text.length < 4) continue;

    const [likes = null, replies = null, reposts = null, shares = null] = trailingNums;
    posts.push({
      account: handle,
      platform: "threads",
      lang,
      text,
      likes: likes,
      reshares: reposts != null || shares != null ? (reposts || 0) + (shares || 0) : null,
      replies: replies,
      timestamp: relTimeToISO(boundaries[b].time),
      url: boundaries[b].url,
    });
  }
  return posts;
}

// 시간 라벨 → ISO. 상대("1h"/"3d"/"2w") + 절대("MM/DD/YY") 둘 다 처리. 실패 시 null.
function relTimeToISO(rel) {
  if (!rel) return null;
  const s = String(rel).trim();
  // 절대 날짜 MM/DD/YY (예: 12/25/25, 01/31/26)
  const abs = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (abs) {
    let [, mo, da, yr] = abs;
    yr = yr.length === 2 ? 2000 + parseInt(yr, 10) : parseInt(yr, 10);
    const d = new Date(Date.UTC(yr, parseInt(mo, 10) - 1, parseInt(da, 10), 12, 0, 0));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // 상대시간
  const m = s.match(/^(\d+)\s*([hdwmy])$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = { h: 3600e3, d: 86400e3, w: 604800e3, m: 2592000e3, y: 31536000e3 }[m[2]] || 3600e3;
  return new Date(Date.now() - n * unit).toISOString();
}

// ───────────────────────── 캐시(누적, 실패 보존) ─────────────────────────
// 구조: { posts: { "<platform>:<account>:<urlHash>": {...post, first_seen, last_updated, text_ko? } }, last_run }
function urlKey(p) {
  const id = (p.url || p.text || "").slice(-64);
  return `${p.platform}:${p.account}:${id}`;
}

export function loadCompetitorsCache() {
  if (!existsSync(CACHE_FILE)) return { posts: {}, last_run: null };
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    raw.posts ??= {};
    return raw;
  } catch {
    return { posts: {}, last_run: null };
  }
}

function saveCache(cache) {
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
}

// freshPosts 를 캐시에 머지(text_ko 등 기존 번역 보존). 빈 배열이면 누적본만 반환.
export function mergeCompetitorsCache(freshPosts = []) {
  const cache = loadCompetitorsCache();
  const now = new Date().toISOString();
  for (const p of freshPosts) {
    const key = urlKey(p);
    const prev = cache.posts[key];
    cache.posts[key] = {
      ...prev,            // text_ko 등 기존 번역 보존
      ...p,               // 최신 지표 갱신
      text_ko: prev?.text_ko ?? p.text_ko ?? null,
      first_seen: prev?.first_seen ?? now,
      last_updated: now,
    };
  }
  if (freshPosts.length) cache.last_run = now;
  saveCache(cache);
  return Object.values(cache.posts);
}

// 번역을 캐시에 기록(상위 5개만 호출됨). entries: [{ key|url, text_ko }]
export function applyTranslations(translations = []) {
  if (!translations.length) return loadCompetitorsCache();
  const cache = loadCompetitorsCache();
  const byUrl = {};
  for (const [k, v] of Object.entries(cache.posts)) if (v.url) byUrl[v.url] = k;
  for (const t of translations) {
    const key = t.key || byUrl[t.url];
    if (key && cache.posts[key]) cache.posts[key].text_ko = t.text_ko;
  }
  saveCache(cache);
  return cache;
}

// 번역이 필요한 글 추출: 각 경쟁사별 참여순 "상위 N(기본 5)" 중 아직 text_ko 없는 글.
// 핵심: 상위 N 집합은 번역 여부와 무관하게 먼저 고정한 뒤, 그 안에서 미번역만 후보로 낸다.
// (그래야 상위 5개를 다 번역하면 picks 가 0이 되고, 6~10위로 슬라이딩하지 않음)
// 한국어 원문(kr)은 번역 불필요라 항상 제외.
export function pickForTranslation(allPosts, perAccount = 5) {
  const byAcct = {};
  for (const p of allPosts) {
    if (p.lang === "kr") continue;             // 한국어 원문은 번역 불필요
    (byAcct[p.account] ??= []).push(p);
  }
  const picks = [];
  for (const list of Object.values(byAcct)) {
    list.sort((a, b) => ((b.likes || 0) + (b.reshares || 0)) - ((a.likes || 0) + (a.reshares || 0)));
    for (const p of list.slice(0, perAccount)) {
      if (p.text_ko) continue;                 // 상위 N 안에서 이미 번역된 건 스킵
      picks.push({ key: urlKey(p), url: p.url, text: p.text, account: p.account, lang: p.lang });
    }
  }
  return picks;
}

// ───────────────────────── 무료 자동 번역(LLM 키 불필요) ─────────────────────────
// 무료 구글번역 엔드포인트(translate_a/single). 토큰/키 불필요.
//   GET …/translate_a/single?client=gtx&sl=auto&tl=ko&dt=t&q=<encodeURIComponent(text)>
//   → 응답 JSON 배열 result[0] = [[번역세그, 원문세그, …], …]  → 세그[0] 들을 이어붙임.
// 실패해도 throw 하지 않고 null 반환(원문 유지) — 캐시/파이프라인 보존 우선.
async function translateOne(text) {
  const t = (text || "").trim();
  if (!t) return null;
  // 너무 긴 글은 엔드포인트가 잘림/실패할 수 있어 안전 길이로 컷(번역 미리보기 용도라 충분).
  const q = encodeURIComponent(t.slice(0, 1800));
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=ko&dt=t&q=${q}`;
  const out = await curl(["-sL", url, "-H", `User-Agent: ${UA}`, "--max-time", "20"], 25000);
  if (!out) return null;
  try {
    const data = JSON.parse(out);
    const segs = data?.[0];
    if (!Array.isArray(segs)) return null;
    const ko = segs.map((s) => (Array.isArray(s) ? s[0] : "")).join("").trim();
    return ko || null;
  } catch {
    return null;
  }
}

// 번역 후보(picks: pickForTranslation 결과)를 무료 엔드포인트로 순차 번역 → 캐시에 text_ko 기록.
// - KR 은 pickForTranslation 단계에서 이미 제외됨(여기서도 방어적으로 스킵).
// - 호출 사이 gapMs(기본 300ms) 간격 → rate-limit 회피. 실패 건은 건너뜀(throw X).
// 반환: { translated, failed, picks } (보고용).
export async function translatePicks(picks = [], { gapMs = 300, max = 60 } = {}) {
  const todo = picks.filter((p) => p.lang !== "kr" && p.text).slice(0, max);
  const done = [];
  let failed = 0;
  for (const p of todo) {
    const ko = await translateOne(p.text);
    if (ko) done.push({ key: p.key, url: p.url, text_ko: ko });
    else failed++;
    if (gapMs) await sleep(gapMs);
  }
  if (done.length) applyTranslations(done);   // 캐시에 머지(기존 text_ko 보존 규칙은 applyTranslations 가 덮어쓰지만, picks 는 미번역만 옴)
  return { translated: done.length, failed, picks: todo.length };
}

// ───────────────────────── 오케스트레이션 ─────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 모든 경쟁사 순차 크롤(동시성 낮춰 rate-limit 회피) → 캐시 머지 → 결과 요약.
// 실패한 소스는 건너뛰고 나머지는 캐시에 합쳐 보존. jina/syndication rate-limit 회피용 간격(GAP).
export async function crawlAllCompetitors({ gapMs = 4000 } = {}) {
  const report = { x: {}, threads: {}, collected: 0 };
  const fresh = [];

  for (const c of COMPETITORS.x) {
    const r = await fetchXTimeline(c.handle, c.lang);
    report.x[c.handle] = r.ok ? r.posts.length : `⏭ ${r.reason}`;
    fresh.push(...r.posts);
    await sleep(gapMs);
  }
  for (const c of COMPETITORS.threads) {
    const r = await fetchThreadsTimeline(c.handle, c.lang);
    report.threads[c.handle] = r.ok ? r.posts.length : `⏭ ${r.reason}`;
    fresh.push(...r.posts);
    await sleep(gapMs);
  }

  const all = mergeCompetitorsCache(fresh);  // 실패해도 빈 fresh → 누적본 보존
  report.collected = fresh.length;
  report.cacheTotal = all.length;
  return { report, all };
}
