// render.mjs — Presentation 계층: 멀티계정 × 3뎁스 흐름 대시보드 HTML
// 디자인 SOT = mockup.html (CSS·DOM·전환 JS 그대로). 더미 대신 실데이터 바인딩.
//
// 뷰 구조:  계정 N × 채널 2(threads/instagram) × 뎁스 3(data/analysis/action)
//   뎁스 컨테이너 id = sec-{depth}            (depth = data | analysis | action)
//   계정×채널 뷰 id  = view-{accountId}-{channel}-{depth}
//   .section / .acct-ch-view 는 각각 1개만 .active (전환 JS 가 토글)
//
// 3뎁스 깔때기:
//   📥 data     — SNS 원본(요약 KPI + 원본 글목록 썸네일·원본지표·발행일)
//   📊 analysis — 가중치 점수 랭킹(점수+분해) + 주제×포맷 매트릭스 + 훅 패턴
//   🎯 action   — 고득점 글 패턴에서 도출한 다음 액션플랜 추천(+큐레이션 우선)

import { SCORE_WEIGHTS, benchmarkWithin, KEYWORDS as REF_KEYWORDS, availableMetrics, metricBuckets } from "./logic.mjs";

// ───────────────────────── 포맷 헬퍼 ─────────────────────────
const esc = (s = "") =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => (n == null ? "–" : Number(n).toLocaleString("ko-KR"));
const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\. ?/g, ".").replace(/\.$/, "") : "");

const TOPIC = {
  TROUBLESHOOT: "트러블슈팅", PROMPT_SHARE: "프롬프트공유", AUTOMATION_HOW: "자동화노하우",
  TOOL_INTRO: "도구소개", CASE_STUDY: "사례/실험", COMMUNITY: "커뮤니티", ETC: "기타",
};
const FORMAT = { TEXT_POST: "텍스트", CAROUSEL_ALBUM: "카드(캐러셀)", IMAGE: "이미지", VIDEO: "영상/릴스" };
const HOOK = {
  PAIN: "고통/문제", NUMBER: "숫자", QUESTION: "질문", HOW_TO: "방법약속",
  CLAIM: "반전주장", STORY: "서사", OTHER: "기타",
};
const tp = (t) => TOPIC[t] || t;
const fm = (f) => FORMAT[f] || f;
const hk = (h) => HOOK[h] || h;

const dnm = (ch) => (ch === "threads" ? "조회" : "도달"); // denominator 라벨
const KST_DOW = ["일", "월", "화", "수", "목", "금", "토"];

// 실제 썸네일 <img> (placeholder 폴백). 텍스트 글 등 이미지 없으면 mockup식 그라데이션 placeholder.
function thumbImg(p, w, h) {
  const ph = placeholderSvg(p, w, h);
  if (!p.thumb) return ph;
  // onerror 시 placeholder 로 교체
  const phEnc = ph.replace(/"/g, "&quot;");
  return `<img src="${esc(p.thumb)}" loading="lazy" referrerpolicy="no-referrer" alt="" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.outerHTML=this.dataset.ph" data-ph="${phEnc}">`;
}

// 텍스트/이미지 없는 글용 placeholder — 포맷별 색 + 라벨(mockup 톤)
function placeholderSvg(p, w, h) {
  const grads = {
    VIDEO: ["#A855F7", "#EC4899"],
    CAROUSEL_ALBUM: ["#00C9A7", "#0F9D8E"],
    IMAGE: ["#5AA0FF", "#3182F6"],
    TEXT_POST: ["#1B3A6B", "#0D2040"],
  };
  const [c1, c2] = grads[p.media_type] || ["#334155", "#0F172A"];
  const gid = "g" + Math.random().toString(36).slice(2, 8);
  const icon = p.media_type === "VIDEO" ? "▶" : p.media_type === "CAROUSEL_ALBUM" ? "🗂" : p.media_type === "IMAGE" ? "🖼" : "✎";
  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#${gid})"/><text x="${w / 2}" y="${h / 2 + 6}" font-size="${Math.round(w / 5)}" text-anchor="middle" fill="rgba(255,255,255,.55)" font-family="system-ui">${icon}</text></svg>`;
}

// ───────────────────────── 통계 헬퍼(렌더 전용 집계) ─────────────────────────
function aggregate(rows, keyOf, valOf) {
  const m = {};
  for (const p of rows) for (const k of keyOf(p)) m[k] = (m[k] || 0) + valOf(p);
  return Object.entries(m).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
}
const median = (arr) => {
  const a = arr.filter((x) => x != null && !Number.isNaN(x)).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

// ───────────────────────── 섹션: 요약 ─────────────────────────
function deltaBadge(hist) {
  const day = hist?.day || [];
  if (day.length < 2) return `<div class="kpi-delta flat">= 기록 시작</div>`;
  const d = day[day.length - 1].v - day[0].v;
  if (d > 0) return `<div class="kpi-delta up">▲ +${fmt(d)} (기록 시작 대비)</div>`;
  if (d < 0) return `<div class="kpi-delta down">▼ ${fmt(Math.abs(d))} (기록 시작 대비)</div>`;
  return `<div class="kpi-delta flat">= 0</div>`;
}

function kpiCard(name, tooltip, val, icon, accent, delta = "") {
  const tip = tooltip ? ` <span class="tooltip" title="${esc(tooltip)}">?</span>` : "";
  return `<div class="kpi-card">
    <div class="kpi-top"><div class="kpi-name">${name}${tip}</div><div class="kpi-icon ${accent}">${icon}</div></div>
    <div class="kpi-val">${val}</div>${delta}</div>`;
}

function summaryView(pf, ch) {
  const s = pf.summary;
  const folDay = pf.followerHistory?.day || [];
  const folNow = folDay.length ? folDay[folDay.length - 1].v : s.followers;
  const isTh = ch === "threads";

  const kpis = [
    kpiCard("팔로워", "이 계정을 구독한 사람 수", fmt(folNow), "👥", "blue", deltaBadge(pf.followerHistory)),
    kpiCard(`총 ${dnm(ch)}`, isTh ? "글이 화면에 뜬 횟수 합계" : "이 글을 본 사람 수(중복 제거) 합계", fmt(s.totalReach), "👁", "blue"),
    kpiCard("좋아요", null, fmt(s.totalLikes), "♥", "red"),
    isTh
      ? kpiCard("공유·리포스트", "다른 사람이 내 글을 퍼뜨린 수", fmt(s.totalShares), "↻", "orange")
      : kpiCard("저장", "나중에 보려고 북마크한 수", fmt(s.totalSaves), "🔖", "green"),
    kpiCard("게시글 수", null, fmt(s.count), "📝", "purple"),
    isTh
      ? kpiCard("공유", "다른 사람에게 공유한 수", fmt(s.totalShares), "➦", "orange")
      : kpiCard("공유", "다른 사람에게 DM 으로 공유한 수", fmt(s.totalShares), "➦", "orange"),
  ].join("");

  // 주제별 도달/조회 Top
  const topReach = aggregate(pf.ranked, (p) => p.topics || [], (p) => p.reach || 0).slice(0, 5);
  const topReachCard = topReach.length ? hbarCard(`주제별 ${dnm(ch)} Top 5`, topReach, "var(--blue)") : "";
  // 주제별 저장(IG) / 좋아요(공통)
  const topSecondary = isTh
    ? aggregate(pf.ranked, (p) => p.topics || [], (p) => p.insights?.likes ?? p.like_count ?? 0).slice(0, 5)
    : aggregate(pf.ranked, (p) => p.topics || [], (p) => p.insights?.saved ?? 0).slice(0, 5);
  const secondaryTitle = isTh ? "주제별 좋아요 Top 5" : "주제별 저장 Top 5";
  const secColor = isTh ? "var(--red)" : "var(--green)";
  const topSecondaryCard = topSecondary.length && topSecondary[0].v > 0 ? hbarCard(secondaryTitle, topSecondary, secColor) : "";

  // 주간 좋아요 추이(막대)
  const weekTrend = (pf.trends?.week || []).slice(-7);
  const trendCard = weekTrend.length ? barChartCard(`최근 주간 좋아요 추이`, weekTrend.map((b) => ({ label: b.bucket.slice(5), val: b.likes }))) : "";

  if (!pf.ranked.length) {
    return `<div class="kpi-grid">${kpis}</div>${emptyState("아직 수집된 글이 없습니다. 데이터가 쌓이면 채워집니다.")}`;
  }
  return `<div class="kpi-grid">${kpis}</div>${topReachCard}${topSecondaryCard}${trendCard}`;
}

function hbarCard(title, rows, color) {
  const max = Math.max(...rows.map((r) => r.v), 1);
  const bars = rows.map((r) =>
    `<div class="hbar-row"><div class="hbar-label">${tp(r.k)}</div><div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(3, (r.v / max) * 100).toFixed(0)}%;background:${color}"></div></div><div class="hbar-val">${fmt(r.v)}</div></div>`).join("");
  return `<div class="card"><div class="card-title">${title}</div><div class="hbar-list">${bars}</div></div>`;
}

function barChartCard(title, pts, green = false) {
  if (!pts.length) return "";
  const max = Math.max(...pts.map((p) => p.val), 1);
  const bars = pts.map((p) =>
    `<div class="bar-col"><div class="bar-val-label">${fmt(p.val)}</div><div class="bar-body${green ? " green" : ""}" style="height:${Math.max(4, Math.round((p.val / max) * 100))}px"></div><div class="bar-x">${esc(p.label)}</div></div>`).join("");
  return `<div class="card"><div class="card-title">${title}</div><div class="chart-wrap"><div class="bar-chart">${bars}</div></div></div>`;
}

// ───────────────────────── 인라인 SVG 차트(외부 lib 0) ─────────────────────────
const pct = (n) => (n == null || Number.isNaN(n) ? "–" : `${Number(n).toFixed(n < 10 ? 1 : 0)}%`);

// 라인+면적 SVG 차트(추이용). pts: [{label, val}]. color = hex. 값 라벨/축 라벨 포함.
function svgLineChart(pts, { color = "#3182F6", h = 150, fillTop = "rgba(49,130,246,.18)" } = {}) {
  if (!pts || pts.length < 2) return `<div class="svg-empty">시점이 2개 이상 쌓이면 선이 그려집니다.</div>`;
  const W = 560, H = h, padL = 22, padR = 22, padT = 22, padB = 24;
  const vals = pts.map((p) => p.val);
  const max = Math.max(...vals), min = Math.min(...vals);
  const span = max - min || 1;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const x = (i) => padL + (pts.length === 1 ? innerW / 2 : (i / (pts.length - 1)) * innerW);
  const y = (v) => padT + innerH - ((v - min) / span) * innerH;
  const linePts = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.val).toFixed(1)}`).join(" ");
  const area = `${padL},${(padT + innerH).toFixed(1)} ${linePts} ${(padL + innerW).toFixed(1)},${(padT + innerH).toFixed(1)}`;
  const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.val).toFixed(1)}" r="3" fill="${color}"/>`).join("");
  // 값 라벨은 첫·마지막·최대만(겹침 방지)
  const maxIdx = vals.indexOf(max);
  const labelIdx = new Set([0, pts.length - 1, maxIdx]);
  // 가장자리 라벨은 안쪽으로 정렬(start/end)해 잘림 방지
  const anc = (i) => i === 0 ? "start" : i === pts.length - 1 ? "end" : "middle";
  const valLabels = pts.map((p, i) => labelIdx.has(i)
    ? `<text x="${x(i).toFixed(1)}" y="${(y(p.val) - 7).toFixed(1)}" font-size="10" font-weight="700" fill="#4E5968" text-anchor="${anc(i)}">${fmt(p.val)}</text>` : "").join("");
  // x축 라벨은 최대 6개로 솎음
  const stepX = Math.ceil(pts.length / 6);
  const xLabels = pts.map((p, i) => (i % stepX === 0 || i === pts.length - 1)
    ? `<text x="${x(i).toFixed(1)}" y="${H - 6}" font-size="9" fill="#8B95A1" text-anchor="${anc(i)}">${esc(p.label)}</text>` : "").join("");
  return `<svg class="svg-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" role="img">
    <polyline points="${area}" fill="${fillTop}" stroke="none"/>
    <polyline points="${linePts}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${valLabels}${xLabels}
  </svg>`;
}

// 일/주/월 토글 카드(SVG 라인). seriesByGran = { day:[{label,val}], week:[...], month:[...] }.
// data-block + switchGran(this) 패턴 그대로 사용(전환 JS 보존).
function granChartCard(title, seriesByGran, { color = "#3182F6", note = "" } = {}) {
  const block = (pts, idx) =>
    `<div class="data-block${idx === 0 ? " active" : ""}">${svgLineChart(pts, { color })}</div>`;
  return `<div class="card">
    <div class="card-title">${title}${note ? ` <span style="font-size:11px;color:var(--muted);font-weight:400">${note}</span>` : ""}</div>
    <div class="gran-row">
      <button class="gran-btn active" onclick="switchGran(this)">일별</button>
      <button class="gran-btn" onclick="switchGran(this)">주별</button>
      <button class="gran-btn" onclick="switchGran(this)">월별</button>
    </div>
    ${block(seriesByGran.day, 0)}${block(seriesByGran.week, 1)}${block(seriesByGran.month, 2)}
  </div>`;
}

// 발행/인게이지먼트 추이를 일/주/월 버킷(trends)에서 SVG로. trends = pf.trends.{day,week,month}.
function trendChartsBlock(pf, ch) {
  const isTh = ch === "threads";
  const t = pf.trends || {};
  const toPts = (arr, pick) => (arr || []).slice(-30).map((b) => ({ label: b.bucket.slice(5), val: pick(b) }));

  // 발행 수 추이
  const publishSeries = {
    day: toPts(t.day, (b) => b.count),
    week: toPts(t.week, (b) => b.count),
    month: (t.month || []).map((b) => ({ label: b.bucket.slice(2), val: b.count })),
  };
  // 인게이지먼트(좋아요+저장+공유 합) 추이
  const engPick = (b) => (b.likes || 0) + (b.saved || 0) + (b.shares || 0);
  const engSeries = {
    day: toPts(t.day, engPick),
    week: toPts(t.week, engPick),
    month: (t.month || []).map((b) => ({ label: b.bucket.slice(2), val: engPick(b) })),
  };

  const hasData = (publishSeries.day.length + publishSeries.week.length) > 0;
  if (!hasData) return "";

  const pubCard = granChartCard("📅 발행 수 추이", publishSeries, { color: "#7C4DFF", note: "— 일/주/월별 올린 글 개수" });
  const engCard = granChartCard("💬 인게이지먼트 추이", engSeries, { color: isTh ? "#3182F6" : "#05C46B", note: "— 좋아요+저장+공유 합" });
  return pubCard + engCard;
}

// 지표별 일/주/월 분리 추이 — 그 채널에 실제 존재하는 지표마다 토글 라인차트 1개씩.
// pf.ranked(=enrich 된 글)에서 발행일 기준 버킷팅. 없는 지표는 자동 스킵.
const METRIC_COLOR = {
  views: "#3182F6", reach: "#3182F6", likes: "#FF4757", comments: "#05C46B",
  replies: "#05C46B", saved: "#00B894", shares: "#FF7F11", reposts: "#7C4DFF", quotes: "#A55EEA",
};
const METRIC_ICON = {
  views: "👁", reach: "👁", likes: "♥", comments: "💬", replies: "💬",
  saved: "🔖", shares: "➦", reposts: "↻", quotes: "❝",
};
function metricTrendsBlock(pf, ch) {
  const posts = pf.ranked || [];
  if (!posts.length) return "";
  const metrics = availableMetrics(posts, ch);
  if (!metrics.length) return "";

  // 최근 30버킷만(일/주). 월은 전체.
  const trim = (arr, gran) => (gran === "month" ? arr : arr.slice(-30));
  const lbl = (b, gran) => (gran === "month" ? b.bucket.slice(2) : b.bucket.slice(5));
  const seriesFor = (m, gran) => trim(metricBuckets(posts, m.field, gran, m.valueOf), gran)
    .map((b) => ({ label: lbl(b, gran), val: b.val }));

  const cards = metrics.map((m) => {
    const series = { day: seriesFor(m, "day"), week: seriesFor(m, "week"), month: seriesFor(m, "month") };
    const icon = METRIC_ICON[m.field] || "📈";
    const color = METRIC_COLOR[m.field] || "#3182F6";
    return granChartCard(`${icon} ${m.label} 추이`, series, { color, note: "— 발행일 기준 일/주/월 합" });
  }).join("");

  const head = `<div class="card-title" style="margin:18px 0 10px">📈 지표별 추이 <span style="font-size:11px;color:var(--muted);font-weight:400">— 각 지표를 일/주/월로 분리해서 봅니다 (이 채널 가용 지표만)</span></div>`;
  return head + cards;
}

// 팔로워 추이를 SVG 라인으로(일/주/월). followerHistory = { day,week,month }.
function followerSvgCard(pf) {
  const h = pf.followerHistory || {};
  const series = { day: h.day || [], week: h.week || [], month: h.month || [] };
  if ((series.day.length + series.week.length + series.month.length) === 0) return "";
  const cur = series.day.length ? series.day[series.day.length - 1].v
    : series.week.length ? series.week[series.week.length - 1].v : pf.summary.followers;
  const net = series.day.length >= 2 ? series.day[series.day.length - 1].v - series.day[0].v : null;
  const badge = net == null ? `<span class="trend-badge flat">기록 시작</span>`
    : net > 0 ? `<span class="trend-badge up">▲ +${fmt(net)}</span>`
      : net < 0 ? `<span class="trend-badge down">▼ ${fmt(Math.abs(net))}</span>`
        : `<span class="trend-badge flat">= 0</span>`;
  // svgLineChart 는 {label,val} 기대 — followerHistory 는 {label,v}
  const map = (arr) => (arr || []).map((d) => ({ label: d.label, val: d.v }));
  const series2 = { day: map(series.day), week: map(series.week), month: map(series.month) };
  const block = (pts, idx) => `<div class="data-block${idx === 0 ? " active" : ""}">${svgLineChart(pts, { color: "#05C46B", fillTop: "rgba(5,196,107,.16)" })}</div>`;
  return `<div class="card">
    <div class="card-title" style="display:flex;align-items:center;justify-content:space-between">👥 팔로워 추이 ${badge}</div>
    <div style="font-size:30px;font-weight:800;letter-spacing:-.03em;margin-bottom:10px">${fmt(cur)} <span style="font-size:13px;font-weight:400;color:var(--muted)">명</span></div>
    <div class="gran-row">
      <button class="gran-btn active" onclick="switchGran(this)">일별</button>
      <button class="gran-btn" onclick="switchGran(this)">주별</button>
      <button class="gran-btn" onclick="switchGran(this)">월별</button>
    </div>
    ${block(series2.day, 0)}${block(series2.week, 1)}${block(series2.month, 2)}
  </div>`;
}

// ───────────────────────── 섹션: 인기 글 ─────────────────────────
function topPostsView(pf, ch) {
  const isTh = ch === "threads";
  if (!pf.ranked.length) return emptyState("아직 수집된 글이 없습니다.");
  const sorted = pf.ranked.slice().sort((a, b) => (b.eng ?? 0) - (a.eng ?? 0)).slice(0, 12);
  const cards = sorted.map((p) => postCard(p, isTh)).join("");
  return `<div class="post-list">${cards}</div>`;
}

function postCard(p, isTh) {
  const i = p.insights || {};
  const likes = i.likes ?? p.like_count ?? 0;
  const reach = p.reach ?? 0;
  const text = (p.text || "").replace(/\n/g, " ").trim();
  const hookText = text.slice(0, 90) || "(텍스트 없음)";

  // 비디오/캐러셀 오버레이
  const overlay = p.media_type === "VIDEO"
    ? `<div class="play-badge"><span>▶</span></div>`
    : p.media_type === "CAROUSEL_ALBUM"
      ? `<div class="carousel-badge"><span></span><span></span><span></span></div>`
      : "";

  const tags = [
    `<span class="tag tag-fmt">${fm(p.media_type)}</span>`,
    `<span class="tag tag-topic">${tp((p.topics || [])[0] || "ETC")}</span>`,
    `<span class="tag tag-hook">${hk(p.hook_type)} 훅</span>`,
    p.is_breakout ? `<span class="tag tag-breakout">바이럴</span>` : "",
  ].join("");

  // 지표(비전공자 톤: 숫자 + 라벨)
  const stats = isTh
    ? [["조회", reach], ["좋아요", likes], ["답글", i.replies ?? 0], ["리포스트", i.reposts ?? 0], ["공유", i.shares ?? 0]]
    : [["도달", reach], ["좋아요", likes], ["댓글", i.comments ?? p.comments_count ?? 0], ["저장", i.saved ?? 0], ["공유", i.shares ?? 0]];
  const statsHtml = stats.map(([l, v]) => `<span class="stat-item"><b>${fmt(v)}</b>${l}</span>`).join("");

  const date = p.timestamp ? `<div class="post-date">${fmtDate(p.timestamp)}${p.permalink ? ` · <a href="${esc(p.permalink)}" target="_blank" rel="noopener" style="color:var(--blue);text-decoration:none">원문 ↗</a>` : ""}</div>` : "";

  return `<div class="post-card${p.is_breakout ? " breakout" : ""}">
    <div class="post-thumb">${thumbImg(p, 120, 150)}${overlay}</div>
    <div class="post-body">
      <div class="post-hook">${esc(hookText)}</div>
      <div class="post-meta">${tags}</div>
      <div class="post-stats">${statsHtml}</div>
      ${date}
    </div>
  </div>`;
}

// ───────────────────────── 섹션: 성장 추이 ─────────────────────────
function growthView(pf, ch) {
  const isTh = ch === "threads";
  const hist = pf.followerHistory || {};
  const day = hist.day || [];
  const week = hist.week || [];
  const month = hist.month || [];
  const cur = day.length ? day[day.length - 1].v : pf.summary.followers;
  const net = day.length >= 2 ? day[day.length - 1].v - day[0].v : null;
  const badge = net == null
    ? `<span class="trend-badge flat">기록 시작</span>`
    : net > 0 ? `<span class="trend-badge up">▲ +${fmt(net)}</span>`
      : net < 0 ? `<span class="trend-badge down">▼ ${fmt(Math.abs(net))}</span>`
        : `<span class="trend-badge flat">= 0</span>`;

  // 팔로워 블록(일/주/월 토글) — mockup switchGran(this, prefix) 패턴: data-block 3개
  const folBlock = (pts, idx) => {
    if (pts.length < 2) {
      const one = pts.length === 1 ? `현재 ${fmt(pts[0].v)}명. ` : "";
      return `<div class="data-block${idx === 0 ? " active" : ""}"><p style="color:var(--muted);font-size:12px;padding:8px 0">${one}추이는 시점이 2개 이상 쌓이면 그려집니다.</p></div>`;
    }
    const max = Math.max(...pts.map((p) => p.v)), min = Math.min(...pts.map((p) => p.v)), span = max - min || 1;
    const bars = pts.map((p) =>
      `<div class="bar-col"><div class="bar-val-label">${fmt(p.v)}</div><div class="bar-body green" style="height:${Math.round(40 + ((p.v - min) / span) * 60)}px"></div><div class="bar-x">${esc(p.label)}</div></div>`).join("");
    return `<div class="data-block${idx === 0 ? " active" : ""}"><div class="bar-chart">${bars}</div></div>`;
  };

  const folCard = `<div class="card">
    <div class="card-title" style="display:flex;align-items:center;justify-content:space-between">팔로워 증감 ${badge}</div>
    <div style="font-size:32px;font-weight:800;letter-spacing:-.03em;margin-bottom:14px">${fmt(cur)} <span style="font-size:14px;font-weight:400;color:var(--muted)">명</span></div>
    <div class="gran-row">
      <button class="gran-btn active" onclick="switchGran(this)">일별</button>
      <button class="gran-btn" onclick="switchGran(this)">주별</button>
      <button class="gran-btn" onclick="switchGran(this)">월별</button>
    </div>
    ${folBlock(day, 0)}${folBlock(week, 1)}${folBlock(month, 2)}
  </div>`;

  // 보조 추이: 주간 좋아요 / IG 는 저장
  const week2 = (pf.trends?.week || []).slice(-7);
  let secCard = "";
  if (week2.length) {
    if (isTh) {
      secCard = barChartCard("주간 좋아요 추이", week2.map((b) => ({ label: b.bucket.slice(5), val: b.likes })));
    } else {
      const note = ` <span style="font-size:11px;color:var(--muted);font-weight:400">— 저장은 알고리즘이 "좋은 콘텐츠"로 인식하는 핵심 신호</span>`;
      const pts = week2.map((b) => ({ label: b.bucket.slice(5), val: b.saved }));
      secCard = barChartCard("주간 저장 추이" + note, pts, true);
    }
  }
  if (!day.length && !week2.length) return emptyState("팔로워·성과 추이는 데이터가 쌓이면 채워집니다.");
  return folCard + secCard;
}

// ───────────────────────── 섹션: 훅 분석 ─────────────────────────
function hooksView(pf, ch) {
  const hooks = (pf.hooks || []).filter((h) => h.value != null);
  if (!hooks.length) return emptyState("글이 더 쌓이면 훅 패턴이 여기에 채워집니다.");
  const isTh = ch === "threads";
  const max = Math.max(...hooks.map((h) => h.value || 0), 0.001);
  const color = isTh ? "var(--blue)" : "var(--green)";
  const rows = hooks.map((h) =>
    `<div class="hbar-row"><div class="hbar-label">${hk(h.hook)}<span style="color:var(--muted);font-weight:400;font-size:11px"> n=${h.count}</span></div><div class="hbar-track"><div class="hbar-fill" style="width:${((h.value || 0) / max * 100).toFixed(0)}%;background:${color}"></div></div><div class="hbar-val">${fmt(h.value)}</div></div>`).join("");

  const best = hooks[0];
  const guide = `<div style="background:var(--blue-soft);border-radius:10px;padding:12px 14px;font-size:12px;color:var(--sub);margin-top:8px"><b style="color:var(--text)">해석 가이드</b> — 가장 높은 반응을 끌어낸 첫 문장 유형은 <b>${hk(best.hook)}</b>입니다. 다음 글은 이 패턴으로 첫 줄을 열어 보세요.</div>`;

  // 훅별 예시 문장(실제 글에서 추출)
  const samples = sampleByHook(pf.ranked);
  const sMax = Math.max(...samples.map((s) => s.value || 0), 0.001); // 막대는 예시값 자체의 최대로 스케일(폭주 방지)
  const grid = samples.length
    ? `<div class="card"><div class="card-title">훅 유형별 예시 문장 <span style="font-size:11px;color:var(--muted);font-weight:400">— 실제 게시글에서</span></div><div class="hook-grid">${samples.map((s) =>
      `<div class="hook-card"><div class="hook-name">${hk(s.hook)} — 중앙 참여수 ${fmt(s.value)}</div><div class="hook-bar-wrap"><div class="hook-bar" style="width:${Math.min(100, Math.max(8, s.value / sMax * 100)).toFixed(0)}%"></div></div><div class="hook-sample" style="margin-top:8px">"${esc(s.text)}"</div></div>`).join("")}</div></div>`
    : "";

  return `<div class="card"><div class="card-title">훅 유형별 중앙 참여수 <span style="font-size:11px;color:var(--muted);font-weight:400">— 좋아요+댓글+저장+공유 등 합</span></div><div class="hbar-list">${rows}</div>${guide}</div>${grid}`;
}

function sampleByHook(ranked) {
  const byHook = {};
  for (const p of ranked) {
    if (p.insights == null) continue;
    const h = p.hook_type;
    if (!byHook[h] || (p.eng ?? 0) > (byHook[h].eng ?? 0)) byHook[h] = p;
  }
  return Object.entries(byHook)
    .map(([hook, p]) => ({ hook, value: p.eng ?? 0, text: (p.hook_text || (p.text || "").slice(0, 42)) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 4);
}

// ───────────────────────── 섹션: 콘텐츠 추천 ─────────────────────────
const HOOK_SUGGEST = {
  PAIN: "“〇〇로 △일 날렸습니다 — 해결법은…” 식 고통 오프닝",
  NUMBER: "“〇〇의 84%가 …” 식 숫자 오프닝",
  QUESTION: "“이거 겪어보셨나요?” 식 독자 질문",
  HOW_TO: "“3분이면 됩니다” 식 방법 약속",
  CLAIM: "“오히려 …였던 이유” 식 반직관 주장",
  STORY: "“저도 처음엔…” 1인칭 서사",
  OTHER: "강한 첫 문장 1개",
};

function recsView(pf) {
  // 1) 큐레이션(content-recommendations.json) 우선
  if (pf.curated && (pf.curated.recs || []).length) return curatedRecs(pf.curated);
  // 2) logic.recommend() 폴백
  if ((pf.recommendations || []).length) return autoRecs(pf.recommendations);
  // 3) 빈 상태
  return emptyState("추천 준비 중 — 데이터가 더 쌓이면 자동 생성됩니다.");
}

function curatedRecs(curated) {
  const recs = (curated.recs || []).slice().sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  const items = recs.map((r) => {
    const hot = r.priority && r.priority <= 3;
    const badge = r.priority ? (hot ? `이번주 #${r.priority}` : `다음주 #${r.priority}`) : "추천";
    const effTag = r.effect ? `<span class="tag" style="background:var(--orange-soft);color:#9A5200">${esc(r.effect)}</span>` : "";
    return `<div class="rec-item">
      <div class="rec-badge${hot ? " hot" : ""}">${badge}</div>
      <div class="rec-body">
        <div class="rec-title">${esc(r.title)}</div>
        ${r.hook ? `<div class="rec-hook-text">"${esc(r.hook)}"</div>` : ""}
        <div class="rec-tags"><span class="tag tag-fmt">${fm(r.format)}</span>${r.topic ? `<span class="tag tag-topic">${esc(r.topic)}</span>` : ""}${r.hook ? "" : ""}${effTag}</div>
        <div class="rec-rationale">근거: ${esc(r.rationale || "")}</div>
      </div>
    </div>`;
  }).join("");
  const stop = (curated.stop || []).map((s) => `<li>${esc(s)}</li>`).join("");
  const stopBox = stop ? `<div class="stop-box"><div class="stop-title">줄여야 할 패턴</div><ul class="stop-list">${stop}</ul></div>` : "";
  return `<div class="card"><div class="rec-list">${items}</div>${stopBox}</div>`;
}

function autoRecs(recs) {
  const items = recs.map((r, idx) => {
    const low = r.lowSample ? ` · <span style="color:var(--red)">⚠️ 표본 적음(${r.count})</span>` : "";
    const gap = ` · 마지막 발행 ${r.daysSince}일 전`;
    return `<div class="rec-item">
      <div class="rec-badge${idx === 0 ? " hot" : ""}">추천 #${idx + 1}</div>
      <div class="rec-body">
        <div class="rec-title">${fm(r.format)} × ${tp(r.topic)}</div>
        <div class="rec-hook-text">제안 훅 — ${esc(HOOK_SUGGEST[r.hook] || "강한 첫 문장 1개")}</div>
        <div class="rec-tags"><span class="tag tag-fmt">${fm(r.format)}</span><span class="tag tag-topic">${tp(r.topic)}</span><span class="tag tag-hook">훅: ${hk(r.hook)}</span></div>
        <div class="rec-rationale">근거: 이 조합 중앙 참여수 <b>${fmt(r.value)}</b>회 · 표본 ${r.count}개${gap}${low}</div>
      </div>
    </div>`;
  }).join("");
  return `<div class="card"><div style="font-size:12px;color:var(--muted);margin-bottom:10px">🔧 자동 탐지(룰 기반) — 글이 늘면 자동 갱신됩니다. 확정 답이 아닌 데이터 힌트입니다.</div><div class="rec-list">${items}</div></div>`;
}

// ───────────────────────── 섹션: 글 로그 ─────────────────────────
function logView(pf, ch) {
  const isTh = ch === "threads";
  const log = (pf.log || []).slice(0, 21);
  if (!log.length) return emptyState("아직 발행 기록이 없습니다.");

  // dailyLog 항목은 텍스트 요약만 담고 있어 thumb/permalink 가 없음 → ranked 에서 보강
  const byDay = {};
  for (const p of pf.ranked) {
    if (!p.timestamp) continue;
    const kst = new Date(new Date(p.timestamp).getTime() + 9 * 3600 * 1000);
    const k = kst.toISOString().slice(0, 10);
    (byDay[k] ??= []).push(p);
  }

  const days = log.map((d) => {
    const posts = (byDay[d.date] || []).slice().sort((a, b) => (b.eng ?? 0) - (a.eng ?? 0));
    const likes = d.items.reduce((s, i) => s + (i.likes || 0), 0);
    const reach = d.items.reduce((s, i) => s + (i.reach || 0), 0);
    const kst = new Date(`${d.date}T00:00:00Z`);
    const dateLabel = `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 (${KST_DOW[kst.getUTCDay()]})`;
    const summary = isTh
      ? `${d.items.length}개 게시 · 좋아요 ${fmt(likes)} · 조회 ${fmt(reach)}`
      : `${d.items.length}개 게시 · 좋아요 ${fmt(likes)} · 도달 ${fmt(reach)}`;
    const items = posts.map((p) => logItem(p, isTh)).join("");
    return `<div class="log-day"><div class="log-day-head"><div class="log-date">${dateLabel}</div><div class="log-summary">${summary}</div></div><div class="log-posts">${items}</div></div>`;
  }).join("");
  return `<div class="card">${days}</div>`;
}

function logItem(p, isTh) {
  const i = p.insights || {};
  const likes = i.likes ?? p.like_count ?? 0;
  const reach = p.reach ?? 0;
  const text = (p.text || "").replace(/\n/g, " ").trim().slice(0, 60) || "(텍스트 없음)";
  const overlay = p.media_type === "VIDEO" ? `<div class="play-sm">▶</div>` : "";
  const link = p.permalink ? `href="${esc(p.permalink)}" target="_blank" rel="noopener"` : "";
  const wrap = (inner) => (p.permalink ? `<a class="log-post-item" ${link} style="text-decoration:none;color:inherit">${inner}</a>` : `<div class="log-post-item">${inner}</div>`);
  return wrap(`<div class="log-thumb">${thumbImg(p, 48, 48)}${overlay}</div>
    <span class="tag tag-fmt" style="flex-shrink:0">${fm(p.media_type)}</span>
    <div class="log-post-text">${esc(text)}</div>
    <div class="log-post-stats">
      <div class="log-stat"><b>${fmt(likes)}</b><span>좋아요</span></div>
      <div class="log-stat"><b>${fmt(reach)}</b><span>${isTh ? "조회" : "도달"}</span></div>
    </div>`);
}

// ═════════════════════════════════════════════════════════════════════
// 3뎁스 흐름 (깔때기: 원본 → 분석 → 액션)
// ═════════════════════════════════════════════════════════════════════

// ───────────────────────── 뎁스 1 — 📥 SNS 데이터 (원본) ─────────────────────────
// 계정 요약(팔로워·글수·원본 지표 합계) 상단 + 게시물 원본 목록(썸네일+원본 지표 숫자+발행일).
function depth1View(pf, ch) {
  const s = pf.summary;
  const isTh = ch === "threads";
  const folDay = pf.followerHistory?.day || [];
  const folNow = folDay.length ? folDay[folDay.length - 1].v : s.followers;

  const kpis = [
    kpiCard("팔로워", "이 계정을 구독한 사람 수", fmt(folNow), "👥", "blue", deltaBadge(pf.followerHistory)),
    kpiCard("게시글 수", "수집된 글 개수", fmt(s.count), "📝", "purple"),
    kpiCard(`총 ${dnm(ch)}`, isTh ? "글이 화면에 뜬 횟수 합계" : "이 글을 본 사람 수(중복 제거) 합계", fmt(s.totalReach), "👁", "blue"),
    kpiCard("총 좋아요", "원본 좋아요 합계", fmt(s.totalLikes), "♥", "red"),
    isTh
      ? kpiCard("총 공유·리포스트", "다른 사람이 내 글을 퍼뜨린 수 합계", fmt(s.totalShares), "↻", "orange")
      : kpiCard("총 저장", "나중에 보려고 북마크한 수 합계", fmt(s.totalSaves), "🔖", "green"),
    kpiCard("총 공유", isTh ? "다른 사람에게 공유한 수 합계" : "DM 으로 공유한 수 합계", fmt(s.totalShares), "➦", "orange"),
  ].join("");

  if (!pf.ranked.length) {
    return `<div class="kpi-grid">${kpis}</div>${emptyState("아직 수집된 글이 없습니다. 데이터가 쌓이면 채워집니다.")}`;
  }

  // 일/주/월 추이 SVG(팔로워 + 발행/인게이지먼트) — ①뎁스에서 한눈에
  const charts = followerSvgCard(pf) + trendChartsBlock(pf, ch) + metricTrendsBlock(pf, ch);

  // 원본 게시물 목록 — 발행일(최신) 순. 가공 없이 원본 지표만. (클라이언트 정렬 토글 지원)
  const sorted = pf.ranked.slice().sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  const cards = sorted.map((p) => rawPostCard(p, isTh)).join("");
  const note = `<div class="card-title" style="margin:18px 0 10px">📋 게시물 원본 <span style="font-size:11px;color:var(--muted);font-weight:400">— ${fmt(sorted.length)}개. SNS에서 받은 그대로의 지표입니다. 버튼으로 정렬을 바꿀 수 있어요.</span></div>`;
  const sortRow = postSortRow(isTh);
  return `<div class="kpi-grid">${kpis}</div>${charts}${note}${sortRow}<div class="post-list" data-sortlist>${cards}</div>`;
}

// 원본 글 목록 정렬 토글 버튼 행 — gran-row/gran-btn 톤 재사용. data-sortkey 로 정렬 키 지정.
// 채널에 존재하는 지표만 버튼으로 노출(threads/instagram 분기).
function postSortRow(isTh) {
  const btns = isTh
    ? [["date", "최신"], ["likes", "좋아요"], ["shares", "공유"], ["reposts", "리포스트"], ["reach", "조회"], ["eng", "참여(합)"]]
    : [["date", "최신"], ["likes", "좋아요"], ["shares", "공유"], ["saved", "저장"], ["reach", "도달"], ["eng", "참여(합)"]];
  const html = btns.map(([key, label], i) =>
    `<button class="gran-btn sort-btn${i === 0 ? " active" : ""}" data-sortkey="${key}" onclick="sortPosts(this)">${label}</button>`).join("");
  return `<div class="gran-row sort-row">${html}</div>`;
}

// 원본 글카드 — 썸네일(실제 img/placeholder) + 원본 지표 숫자 가로배치 + 발행일. (가공/점수 없음)
function rawPostCard(p, isTh) {
  const i = p.insights || {};
  const likes = i.likes ?? p.like_count ?? 0;
  const reach = p.reach ?? 0;
  const text = (p.text || "").replace(/\n/g, " ").trim();
  const hookText = text.slice(0, 90) || "(텍스트 없음)";

  const overlay = p.media_type === "VIDEO"
    ? `<div class="play-badge"><span>▶</span></div>`
    : p.media_type === "CAROUSEL_ALBUM"
      ? `<div class="carousel-badge"><span></span><span></span><span></span></div>`
      : "";

  const fmtTag = `<span class="tag tag-fmt">${fm(p.media_type)}</span>`;

  const stats = isTh
    ? [["조회", reach], ["좋아요", likes], ["답글", i.replies ?? 0], ["리포스트", i.reposts ?? 0], ["인용", i.quotes ?? 0], ["공유", i.shares ?? 0]]
    : [["도달", reach], ["좋아요", likes], ["댓글", i.comments ?? p.comments_count ?? 0], ["저장", i.saved ?? 0], ["공유", i.shares ?? 0]];
  const statsHtml = stats.map(([l, v]) => `<span class="stat-item"><b>${fmt(v)}</b>${l}</span>`).join("");

  const date = p.timestamp ? `<div class="post-date">${fmtDate(p.timestamp)}${p.permalink ? ` · <a href="${esc(p.permalink)}" target="_blank" rel="noopener" style="color:var(--blue);text-decoration:none">원문 ↗</a>` : ""}</div>` : "";

  // 클라이언트 정렬용 data-* (서버 재생성 없이 JS 가 이 값으로 내림차순 재배치). reach = 조회/도달.
  const ts = p.timestamp ? new Date(p.timestamp).getTime() || 0 : 0;
  const dataAttrs =
    ` data-date="${ts}" data-likes="${likes}" data-shares="${i.shares ?? 0}"` +
    ` data-reposts="${i.reposts ?? 0}" data-saved="${i.saved ?? 0}" data-reach="${reach}" data-eng="${p.eng ?? 0}"`;

  return `<div class="post-card"${dataAttrs}>
    <div class="post-thumb">${thumbImg(p, 120, 150)}${overlay}</div>
    <div class="post-body">
      <div class="post-hook">${esc(hookText)}</div>
      <div class="post-meta">${fmtTag}</div>
      <div class="post-stats">${statsHtml}</div>
      ${date}
    </div>
  </div>`;
}

// ───────────────────────── 뎁스 2 — 📊 데이터 분석 (가중치 점수) ─────────────────────────
// 점수 랭킹(점수+구성 분해+썸네일+원본 지표) + 평균 대비 우수 글 강조 + 훅/주제 패턴.
function depth2View(pf, ch) {
  const isTh = ch === "threads";
  const ranked = pf.scoreRanked || [];
  if (!ranked.length) return emptyState("점수를 매길 글이 아직 없습니다. 인사이트가 쌓이면 채워집니다.");

  // 정식 지표(메인) — 계정 평균 비율 카드. 벤치마킹은 글카드에서 배수/백분위로.
  const metricsCard = formalMetricsSummary(pf, ch);

  // 인게이지먼트 추이 SVG(②뎁스에도 노출)
  const engTrend = trendChartsBlock(pf, ch);

  // 벤치마크용으로 점수 랭킹에 erMultiple/erPercentile 부착
  const benched = benchmarkWithin(ranked);

  // 점수 공식 안내(편집 가능한 가중치를 비전공자에게 노출) — 정식지표 아래 보조로
  const wpf = isTh ? "threads" : "instagram";
  const wEntries = Object.entries(SCORE_WEIGHTS[wpf]);
  const wLabel = { likes: "좋아요", comments: "댓글", saved: "저장", shares: "공유", replies: "답글", reposts: "리포스트", quotes: "인용" };
  const formula = wEntries.map(([m, w]) => `${wLabel[m] || m}×${w}`).join(" + ");
  const avg = ranked.length ? ranked.reduce((s, p) => s + p.scoreTotal, 0) / ranked.length : 0;

  const intro = `<div class="card"><div class="card-title">📐 보조 점수 공식 <span style="font-size:11px;color:var(--muted);font-weight:400">— 퍼지는 신호일수록 가중치가 큽니다(랭킹용)</span></div>
    <div style="font-size:13px;color:var(--sub);line-height:1.7">총점 = <b style="color:var(--text)">${esc(formula)}</b><br>
    <span style="font-size:12px;color:var(--muted)">이 ${ranked.length}개 글의 평균 점수는 <b style="color:var(--text)">${fmt(Math.round(avg))}점</b>. 평균을 넘은 글에 <span style="color:var(--blue);font-weight:700">우수</span> 배지가 붙습니다.</span></div></div>`;

  const top = benched.slice(0, 12);
  const cards = top.map((p) => scorePostCard(p, isTh)).join("");

  // 패턴 분석(훅 + 주제×포맷) — 기존 hooksView 재활용 + 매트릭스
  const hooksBlock = hooksView(pf, ch);
  const matrixBlock = matrixCard(pf, ch);

  const listNote = `<div class="card-title" style="margin:18px 0 10px">🏅 글별 정식 지표 + 벤치마킹 <span style="font-size:11px;color:var(--muted);font-weight:400">— 인게이지먼트율 · 계정 평균 대비 배수/백분위</span></div>`;
  return `${metricsCard}${engTrend}${listNote}<div class="post-list">${cards}</div>${matrixBlock}${hooksBlock}${intro}`;
}

// 정식 지표(A) 요약 카드 — 계정×채널 평균 인게이지먼트율/저장율/공유율/바이럴계수.
function formalMetricsSummary(pf, ch) {
  const isTh = ch === "threads";
  const rows = (pf.scoreRanked || []).filter((p) => p.metrics?.engagementRate != null);
  const avgOf = (pick) => {
    const vals = rows.map(pick).filter((x) => x != null && !Number.isNaN(x));
    return vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
  };
  const er = avgOf((p) => p.metrics.engagementRate);
  const sr = isTh ? null : avgOf((p) => p.metrics.saveRate);
  const shr = avgOf((p) => p.metrics.shareRate);
  const vc = avgOf((p) => p.metrics.viralCoeff);
  const denomKind = rows[0]?.metrics?.denomKind || (isTh ? "조회" : "도달");

  const cell = (label, val, tip, accent) =>
    `<div class="metric-cell"><div class="metric-label">${label} <span class="tooltip" title="${esc(tip)}">?</span></div><div class="metric-val ${accent}">${pct(val)}</div></div>`;

  const cells = [
    cell("인게이지먼트율", er, `총상호작용 ÷ ${denomKind} × 100. 글이 노출 대비 얼마나 반응을 끌었나(업계 표준 지표).`, "blue"),
    isTh ? null : cell("저장율", sr, "저장 ÷ 도달 × 100. 알고리즘이 좋은 콘텐츠로 인식하는 핵심 신호.", "green"),
    cell("공유율", shr, `공유 ÷ ${denomKind} × 100. 남에게 보낼 만큼 가치 있던 비율.`, "orange"),
    cell("바이럴 계수", vc, isTh ? "(리포스트+인용+공유) ÷ 조회 × 100. 밖으로 퍼진 비율." : "공유 ÷ 도달 × 100. 밖으로 퍼진 비율.", "purple"),
  ].filter(Boolean).join("");

  const noteDenom = rows.some((p) => p.metrics.denomKind === "팔로워")
    ? `<div style="font-size:11px;color:var(--muted);margin-top:8px">일부 글은 ${denomKind} 데이터가 없어 팔로워 수를 분모로 사용했습니다.</div>` : "";

  return `<div class="card"><div class="card-title">📊 정식 지표 (메인) <span style="font-size:11px;color:var(--muted);font-weight:400">— ${fmt(rows.length)}개 글 평균. 비율 지표라 글 수가 달라도 공정 비교됩니다.</span></div>
    <div class="metric-grid">${cells}</div>${noteDenom}</div>`;
}

// 점수 글카드 — 총점 배지 + 점수 구성 분해 + 썸네일 + 원본 지표 동시.
function scorePostCard(p, isTh) {
  const text = (p.text || "").replace(/\n/g, " ").trim();
  const hookText = text.slice(0, 90) || "(텍스트 없음)";
  const overlay = p.media_type === "VIDEO"
    ? `<div class="play-badge"><span>▶</span></div>`
    : p.media_type === "CAROUSEL_ALBUM"
      ? `<div class="carousel-badge"><span></span><span></span><span></span></div>`
      : "";

  // 벤치마킹 배지(정식지표 메인) — 인게이지먼트율 평균 대비 배수 + 백분위
  const m = p.metrics || {};
  const benchTag = p.erMultiple != null
    ? `<span class="tag tag-breakout">평균 ${p.erMultiple.toFixed(1)}배 · 상위 ${100 - (p.erPercentile ?? 0)}%</span>`
    : (p.aboveAvg ? `<span class="tag tag-breakout">우수 (점수 ${p.scoreMultiple ? p.scoreMultiple.toFixed(1) : "?"}배)</span>` : "");

  const tags = [
    `<span class="tag tag-fmt">${fm(p.media_type)}</span>`,
    `<span class="tag tag-topic">${tp((p.topics || [])[0] || "ETC")}</span>`,
    `<span class="tag tag-hook">${hk(p.hook_type)} 훅</span>`,
    benchTag,
  ].join("");

  // 정식 지표 한 줄(메인) — 인게이지먼트율·저장/공유율·바이럴
  const metricChips = m.engagementRate != null
    ? `<div class="metric-row">
        <span class="metric-chip"><b>${pct(m.engagementRate)}</b> 인게이지먼트율</span>
        ${m.saveRate != null ? `<span class="metric-chip"><b>${pct(m.saveRate)}</b> 저장율</span>` : ""}
        <span class="metric-chip"><b>${pct(m.shareRate)}</b> 공유율</span>
        <span class="metric-chip"><b>${pct(m.viralCoeff)}</b> 바이럴</span>
      </div>` : "";

  // 점수 구성 분해 — 0점 항목은 생략(보조). 정식지표 아래 작게.
  const parts = (p.score?.parts || []).filter((pt) => pt.points > 0);
  const breakdown = parts.length
    ? parts.map((pt) => `<span class="score-part">${esc(pt.label)} ${fmt(pt.count)}×${pt.weight}=<b>${fmt(pt.points)}</b></span>`).join("<span class=\"score-plus\">+</span>")
    : `<span class="score-part" style="color:var(--muted)">참여 없음</span>`;

  const date = p.timestamp ? `<div class="post-date">${fmtDate(p.timestamp)}${p.permalink ? ` · <a href="${esc(p.permalink)}" target="_blank" rel="noopener" style="color:var(--blue);text-decoration:none">원문 ↗</a>` : ""}</div>` : "";

  const breakoutCls = (p.erMultiple != null && p.erMultiple >= 1.5) || p.aboveAvg ? " breakout" : "";
  return `<div class="post-card${breakoutCls}">
    <div class="post-thumb">${thumbImg(p, 120, 150)}${overlay}</div>
    <div class="post-body">
      <div class="score-head"><div class="score-badge">${pct(m.engagementRate)}<small>참여율</small></div><div class="post-hook" style="margin:0">${esc(hookText)}</div></div>
      <div class="post-meta">${tags}</div>
      ${metricChips}
      <div class="score-breakdown"><span style="color:var(--muted);font-size:10px;margin-right:4px">보조 점수 ${fmt(p.scoreTotal)} =</span>${breakdown}</div>
      ${date}
    </div>
  </div>`;
}

// 주제 × 포맷 매트릭스 카드 (중앙 참여수 기준 히트맵 느낌의 막대)
function matrixCard(pf, ch) {
  const cells = pf.matrix || {};
  const rows = Object.entries(cells)
    .map(([key, c]) => {
      const [topic, format] = key.split("|");
      return { topic, format, value: c.value ?? 0, count: c.count ?? 0 };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  if (!rows.length) return "";
  const max = Math.max(...rows.map((r) => r.value), 1);
  const bars = rows.map((r) =>
    `<div class="hbar-row"><div class="hbar-label" style="width:150px">${tp(r.topic)} · ${fm(r.format)}<span style="color:var(--muted);font-weight:400;font-size:11px"> n=${r.count}</span></div><div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(3, (r.value / max) * 100).toFixed(0)}%;background:var(--green)"></div></div><div class="hbar-val">${fmt(r.value)}</div></div>`).join("");
  return `<div class="card"><div class="card-title">주제 × 포맷별 중앙 참여수 <span style="font-size:11px;color:var(--muted);font-weight:400">— 어떤 소재를 어떤 형식으로 올렸을 때 가장 반응이 좋았나</span></div><div class="hbar-list">${bars}</div></div>`;
}

// ───────────────────────── 뎁스 3 — 🎯 다음 액션플랜 추천 ─────────────────────────
// 고득점 글의 소재·훅 패턴 추출 추천(자동) + 큐레이션(content-recommendations.json) 우선.
function depth3View(pf, ch) {
  const blocks = [];

  // 1) 큐레이션 우선(있으면)
  if (pf.curated && (pf.curated.recs || []).length) {
    blocks.push(`<div class="card-title" style="margin-bottom:10px">🗂 큐레이션 추천 <span style="font-size:11px;color:var(--muted);font-weight:400">— 사람이 선별한 다음 글 후보</span></div>`);
    blocks.push(curatedRecs(pf.curated));
  }

  // 2) 점수 기반 자동 추천(고득점 글 패턴에서 산출)
  const scoreRecs = pf.scoreRecs || [];
  if (scoreRecs.length) {
    blocks.push(`<div class="card-title" style="margin:18px 0 10px">🔧 데이터 자동 추천 <span style="font-size:11px;color:var(--muted);font-weight:400">— 점수 높은 글들의 소재·훅 패턴에서 도출(결정적)</span></div>`);
    blocks.push(scoreRecsCard(scoreRecs, ch));
  }

  // 3) 경쟁 근거 딱지 — ④뎁스 갭 분석을 액션으로 연결(예: "🇯🇵 @competitor '무료 폰트' 29K → 우리 갭 → 시도")
  const bench = pf.bench;
  if (bench && (bench.gap?.length || bench.worth?.length)) {
    blocks.push(`<div class="card-title" style="margin:18px 0 10px">🔍 경쟁 근거 기반 시도 후보 <span style="font-size:11px;color:var(--muted);font-weight:400">— 경쟁 벤치마크(④)에서 끌어온 갭 소재. 자세한 분석은 🔍 탭에서</span></div>`);
    blocks.push(competitorEvidenceCard(bench));
  }

  // 4) 아무것도 없으면 빈 상태
  if (!blocks.length) return emptyState("추천 준비 중 — 점수 매길 글이 더 쌓이면 자동 생성됩니다.");
  return blocks.join("");
}

// 국가 국기(라벨용) + 핸들 출처 라벨
const FLAG = { jp: "🇯🇵", en: "🌐", kr: "🇰🇷" };
const flagOf = (lang) => FLAG[lang] || "🌐";
const srcLabel = (p) => `${flagOf(p.lang)} @${esc(p.account)}`;

// 액션플랜용 경쟁 근거 딱지 카드 — 갭 소재 상위 + worth-analyzing 상위.
function competitorEvidenceCard(bench) {
  const gapItems = (bench.gap || []).slice(0, 3).map((g) => {
    const s = g.topSample;
    const tag = s ? `${srcLabel(s)} "${esc((s.text_ko || s.text || "").slice(0, 28))}" ${fmt(s.eng)}회` : "";
    return `<div class="rec-item">
      <div class="rec-badge hot">갭 소재</div>
      <div class="rec-body">
        <div class="rec-title">${tp(g.topic)} <span style="font-size:11px;color:var(--muted);font-weight:400">— 우리 0건 / 경쟁 ${fmt(g.compCount)}건</span></div>
        <div class="rec-rationale">${tag ? `${tag} → 우리 갭 → 이 소재 시도` : `경쟁 평균 참여 ${fmt(Math.round(g.compAvgEng))}회. 우리는 아직 안 다룬 소재입니다.`}</div>
      </div>
    </div>`;
  }).join("");
  const worthItems = (bench.worth || []).slice(0, 2).map((w) => {
    const p = w.post;
    return `<div class="rec-item">
      <div class="rec-badge">분석각</div>
      <div class="rec-body">
        <div class="rec-title">${srcLabel(p)} <span style="font-size:11px;color:var(--muted);font-weight:400">${fmt(p.eng)}회 참여</span></div>
        <div class="rec-hook-text">"${esc((p.text_ko || p.hook_text || (p.text || "").slice(0, 50)))}"</div>
        <div class="rec-rationale">근거: ${esc(w.reasons.join(" · "))}</div>
      </div>
    </div>`;
  }).join("");
  return `<div class="card"><div class="rec-list">${gapItems}${worthItems}</div></div>`;
}

// 점수 기반 추천 카드 — 각 카드에 근거(어느 우수 글 패턴에서 왔는지) 명시.
function scoreRecsCard(recs, ch) {
  const items = recs.map((r, idx) => {
    const suggest = HOOK_SUGGEST[r.hook] || "강한 첫 문장 1개";
    return `<div class="rec-item">
      <div class="rec-badge${idx === 0 ? " hot" : ""}">추천 #${idx + 1}</div>
      <div class="rec-body">
        <div class="rec-title">${fm(r.format)} × ${tp(r.topic)}</div>
        <div class="rec-hook-text">제안 훅 — ${esc(suggest)}</div>
        <div class="rec-tags"><span class="tag tag-fmt">${fm(r.format)}</span><span class="tag tag-topic">${tp(r.topic)}</span><span class="tag tag-hook">훅: ${hk(r.hook)}</span></div>
        <div class="rec-rationale">근거: 점수 상위권에 이 조합이 <b>${fmt(r.count)}회</b> 등장 · 평균 <b>${fmt(Math.round(r.avgScore))}점</b>${r.sampleText ? ` · 대표 우수 글 "${esc(r.sampleText)}" (${fmt(r.sampleScore)}점)` : ""}</div>
      </div>
    </div>`;
  }).join("");
  return `<div class="card"><div style="font-size:12px;color:var(--muted);margin-bottom:10px">고득점 글에서 반복적으로 먹힌 소재·형식·훅 조합입니다. 다음 글은 이 패턴을 따라가 보세요.</div><div class="rec-list">${items}</div></div>`;
}

// ───────────────────────── 뎁스 4 — 🔍 경쟁 벤치마크: "오늘의 레퍼런스" ─────────────────────────
// 메인: 오늘 키워드 1개 → 그 키워드 해외 베스트 글 1개를 크게(출처·참여·원문·번역·적용포인트).
// 보조: 국내 Threads 직접비교(간략) + 갭 소재 칩.
function depth4View(pf, ch) {
  const bench = pf.bench;
  if (!bench || !bench.totalCompetitorPosts) {
    return emptyState("경쟁사 데이터가 아직 없습니다. node dashboard.mjs 가 경쟁 크롤에 성공하면 채워집니다. (X는 일시적 rate-limit 가능)");
  }

  const blocks = [];

  // 1) 메인 — 오늘의 레퍼런스 카드
  blocks.push(dailyReferenceCard(bench));

  // 2) 갭 소재 칩(시도 1순위) — 간략
  if ((bench.gap || []).length) blocks.push(gapStripCard(bench));

  // 3) 국내 Threads 직접비교 — 간략(메인 아님)
  blocks.push(`<div class="group-head" style="margin-top:6px">🇰🇷 국내 Threads 직접 비교 <span class="group-sub">— 같은 무대(Threads). 참여 상위 몇 개만</span></div>`);
  blocks.push(competitorGroupCards(bench.sameKr, "kr", { perAccount: 2 }));

  return blocks.join("");
}

// 키워드(#목록) 인덱스 — 어제/오늘/내일 강조.
function keywordIndexHtml(neighbors) {
  const list = REF_KEYWORDS.map((k) => {
    const isToday = neighbors && k === neighbors.today;
    return `<span class="ref-kw-chip${isToday ? " on" : ""}">#${esc(k)}</span>`;
  }).join("");
  return `<div class="ref-kw-index">${list}</div>`;
}

// 오늘의 레퍼런스 메인 카드.
function dailyReferenceCard(bench) {
  const ref = bench.reference || {};
  const nb = bench.refNeighbors || {};
  const apply = bench.refApply || null;
  const today = bench.todayStr || new Date().toISOString().slice(0, 10);
  const kst = new Date(`${today}T00:00:00Z`);
  const dateLabel = `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 (${KST_DOW[kst.getUTCDay()]})`;

  // 헤더
  const head = `<div class="ref-head">
    <div class="ref-eyebrow">📅 오늘의 레퍼런스 <span class="ref-date">${dateLabel}</span></div>
    <div class="ref-kw">#${esc(ref.keyword || "—")}</div>
    ${ref.desc ? `<div class="ref-kw-desc">${esc(ref.desc)}</div>` : ""}
  </div>`;

  // 본문 — 글 1개
  let body;
  const p = ref.post;
  if (!p) {
    body = `<div class="ref-empty">오늘 키워드 <b>#${esc(ref.keyword || "—")}</b>에 해당하는 해외 레퍼런스 글이 아직 수집되지 않았습니다. 크롤이 더 쌓이면 채워집니다.</div>`;
  } else {
    const engChips = [
      p.likes != null ? `<span class="cstat"><b>${fmt(p.likes)}</b>좋아요</span>` : "",
      p.replies != null ? `<span class="cstat"><b>${fmt(p.replies)}</b>답글</span>` : "",
      p.reshares != null ? `<span class="cstat"><b>${fmt(p.reshares)}</b>${p.platform === "x" ? "리트윗" : "리포스트"}</span>` : "",
    ].filter(Boolean).join("");
    // 날짜: 신뢰 가능(dateToShow)하면 표시, 아니면 "최근"
    const dateChip = p.dateToShow
      ? `<span class="ref-when">${fmtDate(p.dateToShow)}</span>`
      : `<span class="ref-when ref-when-recent">최근</span>`;
    const ko = p.text_ko
      ? `<div class="ref-ko"><span class="comp-ko-tag">한국어 번역</span>${esc(p.text_ko)}</div>`
      : `<div class="ref-ko" style="color:var(--muted)"><span class="comp-ko-tag" style="background:var(--soft);color:var(--muted)">번역 대기</span>다음 갱신 때 자동 번역됩니다</div>`;
    const applyBox = apply
      ? `<div class="ref-apply ref-apply-${apply.level}">
          <div class="ref-apply-title">🎯 우리한테 적용</div>
          <div class="ref-apply-body">${esc(apply.sentence)}</div>
        </div>`
      : "";
    body = `<div class="ref-post">
      <div class="ref-src-row">
        <span class="ref-src">${flagOf(p.lang)} @${esc(p.account)}</span>
        <span class="comp-plat">${p.platform === "x" ? "X" : "Threads"}</span>
        ${dateChip}
        <span class="tag tag-hook" style="margin-left:auto">${hk(p.hook_type)} 훅</span>
      </div>
      <div class="ref-text">${esc((p.text || "").replace(/\n/g, " ").slice(0, 320))}</div>
      ${ko}
      <div class="ref-stats">${engChips || `<span class="cstat" style="color:var(--muted)">참여수 비공개</span>`}${p.url ? ` <a href="${esc(p.url)}" target="_blank" rel="noopener" class="comp-link">원문 ↗</a>` : ""}</div>
      ${applyBox}
    </div>`;
  }

  // 하단 — 다른 최신 레퍼런스(헤로 외) + 키워드 인덱스(헤로 키워드 강조)
  const altList = (ref.alts || [])
    .map((a) => `<span class="ref-nav-item">${flagOf(a.lang)} #${esc(a.keyword)}</span>`)
    .join("");
  const nav = `<div class="ref-nav">
    <span class="ref-nav-label">다른 최신 레퍼런스</span>${altList || `<span class="ref-nav-item" style="color:var(--muted)">더 쌓이는 중</span>`}
  </div>${keywordIndexHtml({ today: ref.keyword })}`;

  return `<div class="card ref-card">${head}${body}${nav}</div>`;
}

// 갭 소재 칩(시도 1순위) — 간략 띠.
function gapStripCard(bench) {
  const gap = (bench.gap || []).slice(0, 6);
  if (!gap.length) return "";
  const chips = gap.map((g) => {
    const s = g.topSample;
    return `<div class="gap-chip">
      <div class="gap-topic">${tp(g.topic)}</div>
      <div class="gap-meta">경쟁 ${fmt(g.compCount)}건 · 평균 ${fmt(Math.round(g.compAvgEng))}회 · 우리 <b>0건</b></div>
      ${s ? `<div class="gap-sample">${srcLabel(s)} "${esc((s.text_ko || s.text || "").slice(0, 36))}"</div>` : ""}
    </div>`;
  }).join("");
  return `<div class="card">
    <div class="card-title">🧩 우리가 안 하는 갭 소재 <span style="font-size:11px;color:var(--muted);font-weight:400">— 경쟁은 하는데 우리 0건. 다음 실험 후보</span></div>
    <div class="gap-grid">${chips}</div>
  </div>`;
}

// 소재 매칭 + 갭 카드.
function matchGapCard(bench) {
  const common = (bench.common || []).slice(0, 6);
  const gap = (bench.gap || []).slice(0, 6);

  const commonRows = common.map((c) => {
    const max = Math.max(c.ourAvgEng, c.compAvgEng, 1);
    return `<div class="vs-row${c.weak ? " weak" : ""}">
      <div class="vs-topic">${tp(c.topic)}${c.weak ? ` <span class="vs-weak">우리 약함</span>` : ""}</div>
      <div class="vs-bars">
        <div class="vs-bar-line"><span class="vs-tag ours">우리 ${fmt(c.ourCount)}건</span><div class="vs-track"><div class="vs-fill ours" style="width:${(c.ourAvgEng / max * 100).toFixed(0)}%"></div></div><span class="vs-num">${fmt(Math.round(c.ourAvgEng))}</span></div>
        <div class="vs-bar-line"><span class="vs-tag comp">경쟁 ${fmt(c.compCount)}건</span><div class="vs-track"><div class="vs-fill comp" style="width:${(c.compAvgEng / max * 100).toFixed(0)}%"></div></div><span class="vs-num">${fmt(Math.round(c.compAvgEng))}</span></div>
      </div>
    </div>`;
  }).join("");

  const gapChips = gap.map((g) => {
    const s = g.topSample;
    return `<div class="gap-chip">
      <div class="gap-topic">${tp(g.topic)}</div>
      <div class="gap-meta">경쟁 ${fmt(g.compCount)}건 · 평균 ${fmt(Math.round(g.compAvgEng))}회 · 우리 <b>0건</b></div>
      ${s ? `<div class="gap-sample">${srcLabel(s)} "${esc((s.text_ko || s.text || "").slice(0, 40))}"</div>` : ""}
    </div>`;
  }).join("");

  return `<div class="card">
    <div class="card-title">ⓐ 공통 소재 — 우리 vs 경쟁 (평균 참여수) <span style="font-size:11px;color:var(--muted);font-weight:400">— 둘 다 다루는 소재. 우리가 절반 미만이면 '약함' 표시</span></div>
    ${commonRows || `<div class="svg-empty">아직 겹치는 소재가 없습니다.</div>`}
    <div class="card-title" style="margin-top:20px">ⓑ 갭 소재 = 시도 후보 <span style="font-size:11px;color:var(--muted);font-weight:400">— 경쟁은 하는데 우리는 0건. 다음 실험 1순위</span></div>
    <div class="gap-grid">${gapChips || `<div class="svg-empty">갭 소재가 없습니다(좋은 신호 — 소재 커버리지가 넓음).</div>`}</div>
  </div>`;
}

// 경쟁 글 카드 그룹 — 출처 라벨(@핸들+국기) + 원문 + 번역(text_ko) + 참여수.
// 한 계정이 참여수로 독식하지 않도록 계정별 상위 N(perAccount)만 뽑아 균형 있게 노출.
function competitorGroupCards(posts, kind, { perAccount = 3 } = {}) {
  const byAcct = {};
  for (const p of posts || []) (byAcct[p.account] ??= []).push(p);
  const list = [];
  for (const arr of Object.values(byAcct)) {
    arr.sort((a, b) => (b.eng || 0) - (a.eng || 0));
    list.push(...arr.slice(0, perAccount));
  }
  list.sort((a, b) => (b.eng || 0) - (a.eng || 0)); // 그룹 내 전체는 참여순 정렬(계정은 다양하게 섞임)
  if (!list.length) {
    return `<div class="svg-empty">${kind === "overseas" ? "해외(X) 글 수집 전입니다. X 크롤은 일시적 rate-limit 가능 — 재실행 시 채워집니다." : "국내 Threads 경쟁 글 수집 전입니다."}</div>`;
  }
  const cards = list.map((p) => {
    const engChips = [
      p.likes != null ? `<span class="cstat"><b>${fmt(p.likes)}</b>좋아요</span>` : "",
      p.replies != null ? `<span class="cstat"><b>${fmt(p.replies)}</b>답글</span>` : "",
      p.reshares != null ? `<span class="cstat"><b>${fmt(p.reshares)}</b>${p.platform === "x" ? "리트윗" : "리포스트"}</span>` : "",
    ].filter(Boolean).join("");
    const ko = p.text_ko
      ? `<div class="comp-ko"><span class="comp-ko-tag">번역</span>${esc(p.text_ko)}</div>`
      : (p.lang === "kr" ? "" : `<div class="comp-ko" style="color:var(--muted)"><span class="comp-ko-tag" style="background:var(--soft);color:var(--muted)">번역 대기</span>상위 5개만 번역합니다</div>`);
    return `<div class="comp-card">
      <div class="comp-head"><span class="comp-src">${srcLabel(p)}</span><span class="comp-plat">${p.platform === "x" ? "X" : "Threads"}</span>
        ${p.topics ? `<span class="tag tag-topic">${tp((p.topics || [])[0])}</span>` : ""}<span class="tag tag-hook">${hk(p.hook_type)} 훅</span></div>
      <div class="comp-text">${esc((p.text || "").replace(/\n/g, " ").slice(0, 220))}</div>
      ${ko}
      <div class="comp-stats">${engChips || `<span class="cstat" style="color:var(--muted)">참여수 비공개</span>`}${p.url ? ` <a href="${esc(p.url)}" target="_blank" rel="noopener" class="comp-link">원문 ↗</a>` : ""}</div>
    </div>`;
  }).join("");
  return `<div class="comp-list">${cards}</div>`;
}

// 경쟁 바이럴 글 훅 구조 추출 요약.
function hookSummaryCard(summary) {
  const rows = summary.slice(0, 5).map((s) => {
    const samples = s.samples.map((x) => `<div class="hook-ex">${srcLabel(x)} "${esc((x.text_ko || x.text || "").slice(0, 40))}" <span style="color:var(--muted)">${fmt(x.eng)}회</span></div>`).join("");
    return `<div class="hook-sum-row"><div class="hook-sum-name">${hk(s.hook)} <span style="color:var(--muted);font-weight:400;font-size:11px">— 상위권 ${s.count}회</span></div>${samples}</div>`;
  }).join("");
  return `<div class="card" style="margin-top:22px"><div class="card-title">🪝 경쟁 바이럴 글의 훅 구조 <span style="font-size:11px;color:var(--muted);font-weight:400">— 참여 상위 경쟁 글들이 첫 줄을 어떻게 여나</span></div>${rows}</div>`;
}

// "이거 분석해볼 만함" 추천(E).
function worthCard(worth) {
  const items = worth.slice(0, 5).map((w) => {
    const p = w.post;
    return `<div class="rec-item">
      <div class="rec-badge${w.topicGap ? " hot" : ""}">분석각</div>
      <div class="rec-body">
        <div class="rec-title">${srcLabel(p)} <span style="font-size:11px;color:var(--muted);font-weight:400">${p.platform === "x" ? "X" : "Threads"} · ${fmt(p.eng)}회 참여</span></div>
        <div class="rec-hook-text">"${esc((p.text_ko || (p.text || "").slice(0, 80)))}"</div>
        <div class="rec-tags">${(p.topics || []).slice(0, 1).map((t) => `<span class="tag tag-topic">${tp(t)}</span>`).join("")}<span class="tag tag-hook">${hk(p.hook_type)} 훅</span></div>
        <div class="rec-rationale">근거: ${esc(w.reasons.join(" · ")) || "참여 상위 글"}</div>
      </div>
    </div>`;
  }).join("");
  return `<div class="card" style="margin-top:22px"><div class="card-title">⭐ 이거 분석해볼 만함 <span style="font-size:11px;color:var(--muted);font-weight:400">— 참여 높은데 우리에게 없는 소재/훅. 콕 집은 후보</span></div><div class="rec-list">${items}</div></div>`;
}

// ───────────────────────── 공통 ─────────────────────────
function emptyState(msg) {
  return `<div class="empty-state"><div class="empty-icon">📊</div>${esc(msg)}</div>`;
}

// 3뎁스 흐름. id 가 곧 뷰 id 접미사(view-{acct}-{ch}-{id}) / 섹션 컨테이너 id(sec-{id}).
// ───────────────────────── 뎁스 5 — 🌐 AI 콘텐츠 레이더 (글로벌, community-radar) ─────────────────────────
function radarView(radar) {
  if (!radar || !Array.isArray(radar.global_hot) || !radar.global_hot.length) {
    return `<div class="sec-head"><h2>🌐 5단계 · AI 콘텐츠 레이더</h2><div class="desc">시고르 글로벌 수집기 대기 중 — community-radar가 2시간마다 채웁니다.</div></div><div class="empty-state"><div class="empty-icon">🌐</div>아직 수집된 글이 없어요</div>`;
  }
  const badge = (s = "") => s.startsWith("hackernews") ? "#FF6600" : s.startsWith("geeknews") ? "#3182F6" : s.startsWith("reddit") ? "#7C4DFF" : s.startsWith("x:") ? "#111111" : s.startsWith("threads:") ? "#000000" : s.startsWith("rss:") ? "#16A34A" : s.startsWith("devto:") ? "#3B49DF" : "#8B95A1";
  const row = (x) => {
    const sc = x.scores
      ? `<div class="radar-scores"><span>🎣 후킹 <b>${x.scores.hook}</b></span><span>👥 대중성 <b>${x.scores.popular}</b></span><span>🎓 교육 <b>${x.scores.edu}</b></span><span>⏱ 시의성 <b>${x.scores.timely}</b></span></div>`
      : "";
    const enrich = (x.summary || sc)
      ? `<div class="radar-enrich">${sc}${x.summary ? `<div class="re-sum">📝 ${esc(x.summary).replace(/\n/g, "<br>")}</div>` : ""}${x.why ? `<div class="re-why">💡 ${esc(x.why)}</div>` : ""}</div>`
      : "";
    const link = esc(x.url || x.source_url || "#");
    const stars = x.stars
      ? `<span class="radar-stars" title="콘텐츠 글감가치 ${x.stars}/5">${"★".repeat(x.stars)}<span class="st-off">${"★".repeat(5 - x.stars)}</span></span>`
      : "";
    return `<div class="radar-row">
    <a class="radar-item" href="${link}" target="_blank" rel="noopener">
      <span class="radar-src" style="background:${badge(x.source)}">${esc(x.source)}</span>
      ${stars}
      <span class="radar-title">${esc((x.title || "").slice(0, 86))}</span>
      <span class="radar-meta">fresh ${x.freshness ?? 0}${x.score ? ` · ▲${x.score}` : ""}</span>
    </a>${enrich}</div>`;
  };
  // 글감가치 ⭐순 정렬 + ⭐3+ 게이트(영양가 낮은 ⭐1~2는 접기)
  const sorted = [...radar.global_hot].sort((a, b) => (b.stars || 0) - (a.stars || 0));
  const hot = sorted.filter((x) => (x.stars || 0) >= 3).map(row).join("");
  const lowItems = sorted.filter((x) => (x.stars || 0) < 3);
  const lowHtml = lowItems.length
    ? `<details class="radar-low"><summary>🔽 영양가 낮음 ${lowItems.length}건 (codex가 ⭐1~2로 평가 — 광고·노이즈·비전문가 무관)</summary>${lowItems.map(row).join("")}</details>`
    : "";
  const topics = (radar.kakao_topics || []).slice(0, 8)
    .map((t) => `<span class="radar-topic">${esc(t.topic)} <b>${t.count}</b></span>`).join("");
  // 소스 수집 현황 — 어느 소스에서 몇 개 긁어(b) → 몇 개 노출(→)했는지
  const SRC_META = { rss: ["공식·미디어 RSS", "#16A34A"], devto: ["Dev.to", "#3B49DF"], geeknews: ["긱뉴스", "#3182F6"], hackernews: ["HackerNews", "#FF6600"], x: ["X(트위터)", "#111111"], threads: ["Threads", "#000000"], reddit: ["Reddit", "#7C4DFF"] };
  const counts = radar.counts || {};
  const shown = {};
  radar.global_hot.forEach((x) => { const t = (x.source || "").split(":")[0]; shown[t] = (shown[t] || 0) + 1; });
  const totalCollected = Object.values(counts).reduce((a, b) => a + (b || 0), 0);
  const srcStat = Object.entries(counts).filter(([k, v]) => v > 0 && SRC_META[k]).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => { const [label, color] = SRC_META[k]; return `<span class="ss" style="border-color:${color}"><span class="ss-dot" style="background:${color}"></span>${label} <b>${v}</b>${shown[k] ? `<i>→ ${shown[k]}</i>` : ""}</span>`; }).join("");
  const srcCard = srcStat
    ? `<div class="card"><div class="card-title">📥 소스 수집 현황 <span style="font-size:11px;color:var(--muted);font-weight:400">— 총 ${totalCollected}건 수집 → 글감가치 ⭐로 ${radar.global_hot.length}건 노출 (<b>굵게</b>=수집수, →=화면노출수)</span></div><div class="radar-srcstat">${srcStat}</div></div>`
    : "";
  return `
    <div class="sec-head"><h2>🌐 5단계 · AI 콘텐츠 레이더</h2><div class="desc">글로벌 AI 핫이슈 · 시고르 24시간 수집 · 갱신 ${esc((radar.collected_at || "").slice(0, 16).replace("T", " "))}</div></div>
    ${srcCard}
    ${topics ? `<div class="card"><div class="card-title">🗣️ 커뮤니티 핫주제</div><div class="radar-topics">${topics}</div></div>` : ""}
    <div class="card"><div class="card-title">🔥 글로벌 핫글 <span style="font-size:11px;color:var(--muted);font-weight:400">— 콘텐츠 글감가치 ⭐순. 클릭하면 원문</span></div><div class="radar-list">${hot}</div>${lowHtml}</div>
    <style>
      .radar-srcstat{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
      .ss{display:inline-flex;align-items:center;gap:5px;font-size:12px;padding:5px 11px;border:1.5px solid;border-radius:20px;background:#fff;color:#444}
      .ss-dot{width:7px;height:7px;border-radius:50%;display:inline-block;flex-shrink:0}
      .ss b{font-weight:800;color:#111}
      .ss i{font-style:normal;color:var(--muted);font-size:11px}
      .radar-list{display:flex;flex-direction:column;gap:10px;margin-top:6px}
      .radar-row{display:flex;flex-direction:column}
      .radar-item{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--text);padding:10px 12px;border-radius:10px;background:var(--soft)}
      .radar-enrich{padding:7px 12px 3px 36px;line-height:1.55}
      .radar-scores{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:6px;font-size:11px;color:var(--muted)}
      .radar-scores b{color:#FB6A14;font-weight:800;font-size:12.5px}
      .re-sum{font-size:12.5px;color:var(--text);font-weight:600}
      .re-why{font-size:12px;color:var(--blue-strong);margin-top:3px}
      .radar-stars{color:#FFB020;font-size:12px;letter-spacing:1px;flex-shrink:0}
      .radar-stars .st-off{color:#D9DCE1}
      .radar-item:hover{background:var(--blue-soft)}
      .radar-src{font-size:10px;font-weight:800;color:#fff;padding:2px 7px;border-radius:5px;flex-shrink:0;white-space:nowrap}
      .radar-title{font-weight:600;flex:1;line-height:1.4;font-size:13px}
      .radar-meta{font-size:10px;color:var(--muted);flex-shrink:0;white-space:nowrap}
      .radar-topics{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}
      .radar-topic{background:var(--blue-soft);color:var(--blue-strong);padding:4px 11px;border-radius:20px;font-size:12px;font-weight:600}
      .radar-topic b{color:var(--blue)}
    </style>`;
}

const DEPTHS = [
  { id: "data", step: "1", icon: "📥", label: "SNS 데이터", title: "📥 1단계 · SNS 데이터", desc: "SNS에서 받은 원본 그대로 — 계정 요약 + 일/주/월 추이 + 게시물별 원본 지표·발행일. 가공 전 1차 자료입니다.", build: depth1View },
  { id: "analysis", step: "2", icon: "📊", label: "데이터 분석", title: "📊 2단계 · 데이터 분석", desc: "정식 지표(인게이지먼트율·저장율·공유율·바이럴)로 글을 평가하고, 계정 평균 대비 벤치마킹합니다. 어떤 소재·훅이 먹혔는지 패턴도 봅니다.", build: depth2View },
  { id: "action", step: "3", icon: "🎯", label: "다음 액션플랜", title: "🎯 3단계 · 다음 액션플랜", desc: "우리 우수 글 패턴 + 경쟁 갭 소재를 합쳐 '다음엔 이렇게 올려라'를 도출합니다. 근거가 함께 붙습니다.", build: depth3View },
  { id: "bench", step: "4", icon: "🔍", label: "경쟁 벤치마크", title: "🔍 4단계 · 오늘의 레퍼런스", desc: "매일 키워드 1개를 골라 그 키워드의 해외 베스트 글 1개를 크게 보여줍니다 — 출처·참여·원문·한국어 번역·우리한테 적용 포인트. 아래는 갭 소재와 국내 직접비교.", build: depth4View },
  { id: "radar", step: "5", icon: "🌐", label: "AI 레이더", title: "🌐 5단계 · AI 콘텐츠 레이더", desc: "긱뉴스·HackerNews 등 글로벌 AI 핫이슈를 시고르가 24시간 수집. 출근 전, 밤사이 뜬 AI 소식을 freshness 순으로 봅니다.", build: null },
];
const CHANNELS = [{ id: "threads", icon: "🧵", label: "Threads" }, { id: "instagram", icon: "📷", label: "Instagram" }];

// 한 계정×채널×뎁스 뷰
function buildView(account, chId, depth, isActiveAcct, isActiveCh) {
  const pf = account[chId];
  const chLabel = chId === "threads" ? "Threads" : "Instagram";
  const active = isActiveAcct && isActiveCh; // 초기 active = 첫 계정·threads
  let inner;
  // 채널 데이터 자체가 없으면(토큰 실패 등) 배너
  if (pf.status && !pf.status.ok && !pf.ranked.length) {
    inner = `<div class="empty-state"><div class="empty-icon">⚠️</div>${chLabel} 데이터 없음 — ${esc(pf.status.reason)}</div>`;
  } else {
    inner = depth.build(pf, chId);
  }
  return `<div class="acct-ch-view${active ? " active" : ""}" id="view-${account.id}-${chId}-${depth.id}">
    <div class="sec-head"><h2>${depth.title} — ${esc(account.label)} · ${chLabel}</h2><div class="desc">${esc(depth.desc)}</div></div>
    ${inner}
  </div>`;
}

export function renderDashboard(d) {
  const { accounts, generatedAt } = d;
  const first = accounts[0];

  // 사이드바 — 계정 버튼
  const acctBtns = accounts.map((a, i) => {
    const handle = a.handle || (a.id === "gpters" ? "@gptersorg" : a.id === "bbopters" ? "@bbopters_ai" : "");
    return `<button class="acct-btn${i === 0 ? " active" : ""}" data-acct="${esc(a.id)}" onclick="switchAcct(this)">${esc(a.label)}${handle ? `<small>${esc(handle)}</small>` : ""}</button>`;
  }).join("");

  const chBtns = CHANNELS.map((c, i) =>
    `<button class="ch-btn${i === 0 ? " active" : ""}" data-ch="${c.id}" onclick="switchCh(this)">${c.icon} ${c.label}</button>`).join("");

  const navItems = DEPTHS.map((s, i) =>
    `<button class="nav-item${i === 0 ? " active" : ""}" data-sec="${s.id}" onclick="switchSec(this)"><span class="nav-step">${s.step}</span><span class="nav-icon">${s.icon}</span> ${s.label}</button>`).join("");

  // 뎁스들 — 각 뎁스 안에 모든 계정×채널 뷰
  const sectionsHtml = DEPTHS.map((depth, si) => {
    // AI 레이더는 계정 무관 글로벌 — 계정×채널 루프 없이 1회 렌더
    if (depth.id === "radar") {
      return `<div class="section" id="sec-radar">\n${radarView(d.radar)}\n</div><!-- /sec-radar -->`;
    }
    const views = [];
    for (let ai = 0; ai < accounts.length; ai++) {
      for (let ci = 0; ci < CHANNELS.length; ci++) {
        views.push(buildView(accounts[ai], CHANNELS[ci].id, depth, ai === 0, ci === 0));
      }
    }
    return `<div class="section${si === 0 ? " active" : ""}" id="sec-${depth.id}">\n${views.join("\n")}\n</div><!-- /sec-${depth.id} -->`;
  }).join("\n\n");

  const updated = new Date(generatedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meta Insights — 운영 대시보드</title>
<style>
/* ── 토큰 ── */
:root {
  --blue: #3182F6;
  --blue-strong: #1B64DA;
  --blue-soft: #EBF3FF;
  --green: #05C46B;
  --green-soft: #E4F9EE;
  --red: #F04452;
  --red-soft: #FFEDEE;
  --orange: #FF9500;
  --orange-soft: #FFF4E5;
  --purple: #7C4DFF;
  --purple-soft: #F2EEFF;
  --yellow-soft: #FFFBE5;
  --text: #191F28;
  --sub: #4E5968;
  --muted: #8B95A1;
  --line: #E5E8EB;
  --bg: #F2F4F6;
  --card: #FFFFFF;
  --soft: #F9FAFB;
  --sidebar-w: 220px;
  --radius: 14px;
  --shadow: 0 1px 4px rgba(25,31,40,.07);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.55;
  min-height: 100vh;
}
.app { display: flex; min-height: 100vh; }
.sidebar {
  width: var(--sidebar-w);
  flex-shrink: 0;
  background: var(--card);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow-y: auto;
  z-index: 10;
}
.sidebar-logo {
  padding: 20px 18px 14px;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: -.02em;
  color: var(--text);
  border-bottom: 1px solid var(--line);
}
.sidebar-logo span { color: var(--blue); }
.sidebar-logo .updated {
  display: block;
  font-size: 11px;
  font-weight: 400;
  color: var(--muted);
  margin-top: 2px;
}
.acct-switch { padding: 14px 12px 10px; border-bottom: 1px solid var(--line); }
.acct-label, .ch-label, .nav-label {
  font-size: 10px; font-weight: 700; color: var(--muted);
  letter-spacing: .06em; text-transform: uppercase; margin-bottom: 7px; padding: 0 4px;
}
.acct-btns, .ch-btns { display: flex; gap: 6px; }
.acct-btn, .ch-btn {
  flex: 1; padding: 7px 6px; border: 1.5px solid var(--line); border-radius: 9px;
  background: var(--soft); font-size: 12px; font-weight: 700; color: var(--sub);
  cursor: pointer; text-align: center; transition: all .15s; line-height: 1.3;
}
.acct-btn small { display: block; font-size: 10px; font-weight: 400; color: var(--muted); }
.acct-btn.active { background: var(--blue); border-color: var(--blue); color: #fff; }
.acct-btn.active small { color: rgba(255,255,255,.75); }
.ch-switch { padding: 12px 12px 8px; border-bottom: 1px solid var(--line); }
.ch-btn.active { border-color: var(--blue); color: var(--blue); background: var(--blue-soft); }
.nav-section { padding: 12px 12px 8px; }
.nav-item {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 9px;
  cursor: pointer; font-size: 13px; font-weight: 500; color: var(--sub);
  transition: all .15s; margin-bottom: 2px; border: none; background: none; width: 100%; text-align: left;
}
.nav-item:hover { background: var(--soft); color: var(--text); }
.nav-item.active { background: var(--blue-soft); color: var(--blue); font-weight: 700; }
.nav-icon { font-size: 15px; flex-shrink: 0; }
.nav-step {
  flex-shrink: 0; width: 18px; height: 18px; border-radius: 50%;
  background: var(--line); color: var(--muted); font-size: 10px; font-weight: 800;
  display: inline-flex; align-items: center; justify-content: center;
}
.nav-item.active .nav-step { background: var(--blue); color: #fff; }
/* 점수 글카드 (뎁스2) */
.score-head { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 8px; }
.score-badge {
  flex-shrink: 0; background: linear-gradient(135deg, #5AA0FF 0%, #3182F6 100%); color: #fff;
  border-radius: 10px; padding: 6px 10px; font-size: 18px; font-weight: 800; letter-spacing: -.02em;
  line-height: 1; min-width: 46px; text-align: center;
}
.score-badge small { display: block; font-size: 9px; font-weight: 600; opacity: .85; margin-top: 2px; }
.breakout .score-badge { background: linear-gradient(135deg, #FFC16E 0%, #FF9500 100%); }
.score-breakdown {
  display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
  background: var(--soft); border-radius: 8px; padding: 8px 10px; font-size: 11px; color: var(--sub);
}
.score-part { white-space: nowrap; }
.score-part b { color: var(--text); font-weight: 800; }
.score-plus { color: var(--muted); font-weight: 700; margin: 0 2px; }
.main { flex: 1; min-width: 0; padding: 28px 32px 60px; max-width: 960px; }
.section { display: none; }
.section.active { display: block; }
.acct-ch-view { display: none; }
.acct-ch-view.active { display: block; }
.sec-head { margin-bottom: 22px; }
.sec-head h2 { font-size: 20px; font-weight: 800; letter-spacing: -.02em; margin-bottom: 4px; }
.sec-head .desc { font-size: 13px; color: var(--muted); }
.card {
  background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 20px; box-shadow: var(--shadow); margin-bottom: 14px;
}
.card-title { font-size: 13px; font-weight: 700; color: var(--sub); margin-bottom: 12px; letter-spacing: -.01em; }
.kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 14px; }
.kpi-card {
  background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 18px; box-shadow: var(--shadow);
}
.kpi-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.kpi-name { font-size: 12px; color: var(--muted); font-weight: 600; }
.kpi-name .tooltip {
  font-size: 10px; color: var(--muted); background: var(--soft); border: 1px solid var(--line);
  border-radius: 5px; padding: 1px 5px; margin-left: 4px; font-weight: 400; cursor: help; white-space: nowrap;
}
.kpi-icon {
  width: 28px; height: 28px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center; font-size: 13px;
}
.kpi-icon.blue { background: var(--blue-soft); }
.kpi-icon.green { background: var(--green-soft); }
.kpi-icon.red { background: var(--red-soft); }
.kpi-icon.orange { background: var(--orange-soft); }
.kpi-icon.purple { background: var(--purple-soft); }
.kpi-val { font-size: 26px; font-weight: 800; letter-spacing: -.03em; line-height: 1.1; }
.kpi-delta { font-size: 12px; font-weight: 700; margin-top: 4px; }
.kpi-delta.up { color: var(--green); }
.kpi-delta.down { color: var(--red); }
.kpi-delta.flat { color: var(--muted); }
.chart-wrap { overflow-x: auto; padding-bottom: 4px; }
.bar-chart { display: flex; align-items: flex-end; gap: 10px; min-height: 140px; padding: 8px 0 0; }
.bar-col { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 44px; }
.bar-val-label { font-size: 10px; font-weight: 700; color: var(--sub); }
.bar-body {
  width: 32px; border-radius: 5px 5px 0 0;
  background: linear-gradient(180deg, #5AA0FF 0%, #3182F6 100%); min-height: 4px; transition: height .3s;
}
.bar-body.green { background: linear-gradient(180deg, #2ECC71 0%, #05C46B 100%); }
.bar-body.orange { background: linear-gradient(180deg, #FFC16E 0%, #FF9500 100%); }
.bar-x { font-size: 10px; color: var(--muted); text-align: center; white-space: nowrap; }
.bar-sub { font-size: 9px; color: var(--muted); text-align: center; }
.hbar-list { display: flex; flex-direction: column; gap: 8px; }
.hbar-row { display: flex; align-items: center; gap: 10px; }
.hbar-label {
  width: 100px; font-size: 12px; color: var(--sub); flex-shrink: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.hbar-track { flex: 1; height: 16px; background: var(--soft); border-radius: 5px; overflow: hidden; }
.hbar-fill { height: 100%; border-radius: 5px; background: var(--blue); min-width: 3px; }
.hbar-val { width: 56px; text-align: right; font-size: 12px; font-weight: 700; color: var(--text); }
.gran-row { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
.gran-btn {
  padding: 5px 14px; border-radius: 999px; border: 1.5px solid var(--line); background: var(--soft);
  font-size: 12px; font-weight: 600; color: var(--sub); cursor: pointer; transition: all .15s;
}
.gran-btn.active { background: var(--blue); border-color: var(--blue); color: #fff; }
.post-list { display: flex; flex-direction: column; gap: 14px; }
.post-card {
  background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 0; display: flex; gap: 0; box-shadow: var(--shadow); overflow: hidden;
}
.post-card.breakout { border-color: var(--blue); border-width: 2px; }
.post-thumb { width: 120px; flex-shrink: 0; position: relative; overflow: hidden; border-radius: 0; background: var(--soft); }
.post-thumb svg { display: block; width: 100%; height: 100%; }
.post-thumb .play-badge { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.post-thumb .play-badge span {
  width: 32px; height: 32px; background: rgba(255,255,255,.88); border-radius: 50%;
  display: flex; align-items: center; justify-content: center; font-size: 13px; box-shadow: 0 2px 8px rgba(0,0,0,.18);
}
.post-thumb .carousel-badge { position: absolute; bottom: 6px; right: 6px; display: flex; gap: 3px; }
.post-thumb .carousel-badge span { width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,.9); }
.post-thumb .carousel-badge span:first-child { background: #fff; width: 7px; border-radius: 4px; }
.post-body { flex: 1; min-width: 0; padding: 14px 16px; }
.post-hook {
  font-size: 13px; font-weight: 600; line-height: 1.45; margin-bottom: 8px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.post-meta { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.tag { font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 6px; letter-spacing: .01em; }
.tag-fmt { background: var(--blue-soft); color: var(--blue-strong); }
.tag-topic { background: var(--green-soft); color: #066F3E; }
.tag-hook { background: var(--purple-soft); color: #5B35BB; }
.tag-breakout { background: var(--orange-soft); color: #A05C00; }
.post-stats { display: flex; gap: 0; flex-wrap: wrap; background: var(--soft); border-radius: 8px; overflow: hidden; }
.stat-item {
  flex: 1; min-width: 72px; padding: 7px 10px; font-size: 10px; color: var(--muted);
  border-right: 1px solid var(--line); text-align: center;
}
.stat-item:last-child { border-right: 0; }
.stat-item b {
  display: block; font-size: 15px; font-weight: 800; color: var(--text);
  letter-spacing: -.02em; line-height: 1.2; margin-bottom: 1px;
}
.post-date { font-size: 10px; color: var(--muted); margin-top: 8px; }
@media (max-width: 600px) {
  .post-card { flex-direction: column; }
  .post-thumb { width: 100%; height: 160px; }
  .post-thumb svg { width: 100%; height: 100%; }
}
.hook-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.hook-card { background: var(--soft); border: 1px solid var(--line); border-radius: 10px; padding: 14px; }
.hook-name { font-size: 12px; font-weight: 700; color: var(--sub); margin-bottom: 4px; }
.hook-score { font-size: 22px; font-weight: 800; letter-spacing: -.02em; margin-bottom: 2px; }
.hook-sample { font-size: 11px; color: var(--muted); }
.hook-bar-wrap { margin-top: 8px; }
.hook-bar { height: 6px; border-radius: 4px; background: var(--blue); }
.rec-list { display: flex; flex-direction: column; gap: 0; }
.rec-item { padding: 16px 0; border-top: 1px solid var(--line); display: flex; gap: 14px; align-items: flex-start; }
.rec-item:first-child { border-top: 0; padding-top: 0; }
.rec-badge {
  flex-shrink: 0; min-width: 68px; text-align: center; padding: 4px 8px; border-radius: 8px;
  font-size: 11px; font-weight: 700; background: var(--blue-soft); color: var(--blue-strong);
  height: fit-content; margin-top: 2px;
}
.rec-badge.hot { background: var(--orange-soft); color: #9A5200; }
.rec-body { flex: 1; }
.rec-title { font-size: 14px; font-weight: 700; margin-bottom: 4px; line-height: 1.4; }
.rec-hook-text { font-size: 12px; color: #066F3E; font-style: italic; margin-bottom: 6px; line-height: 1.5; }
.rec-tags { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 6px; }
.rec-rationale { font-size: 11px; color: var(--sub); line-height: 1.5; }
.rec-rationale b { color: var(--text); }
.stop-box { margin-top: 18px; padding: 14px; background: var(--red-soft); border-radius: 10px; }
.stop-title { font-size: 12px; font-weight: 700; color: var(--red); margin-bottom: 8px; }
.stop-list { padding-left: 16px; }
.stop-list li { font-size: 12px; color: var(--sub); margin-bottom: 5px; line-height: 1.5; }
.log-day { padding: 12px 0; border-top: 1px solid var(--line); }
.log-day:first-child { border-top: 0; padding-top: 0; }
.log-day-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.log-date { font-size: 13px; font-weight: 700; color: var(--text); }
.log-summary { font-size: 11px; color: var(--muted); }
.log-posts { display: flex; flex-direction: column; gap: 6px; }
.log-post-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: var(--soft);
  border-radius: 10px; font-size: 12px; overflow: hidden;
}
.log-thumb { width: 48px; height: 48px; border-radius: 8px; flex-shrink: 0; overflow: hidden; position: relative; }
.log-thumb svg { display: block; width: 100%; height: 100%; }
.log-thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
.log-thumb .play-sm { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; }
.log-post-text { flex: 1; color: var(--sub); line-height: 1.4; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.log-post-stats { font-size: 11px; color: var(--muted); white-space: nowrap; flex-shrink: 0; display: flex; gap: 8px; }
.log-stat { display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 36px; text-align: center; }
.log-stat b { font-size: 13px; font-weight: 800; color: var(--text); display: block; letter-spacing: -.01em; }
.log-stat span { font-size: 9px; color: var(--muted); display: block; }
.rec-thumb { width: 54px; height: 68px; border-radius: 8px; flex-shrink: 0; overflow: hidden; }
.rec-thumb svg { display: block; width: 100%; height: 100%; }
.empty-state { text-align: center; padding: 48px 20px; color: var(--muted); font-size: 13px; }
.empty-state .empty-icon { font-size: 36px; margin-bottom: 10px; }
.trend-badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 7px; font-size: 12px; font-weight: 700; }
.trend-badge.up { background: var(--green-soft); color: var(--green); }
.trend-badge.down { background: var(--red-soft); color: var(--red); }
.trend-badge.flat { background: var(--soft); color: var(--muted); }
.data-block { display: none; }
.data-block.active { display: block; }
@media (max-width: 900px) { .kpi-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 768px) {
  .sidebar { position: fixed; left: -100%; transition: left .25s; z-index: 100; }
  .sidebar.open { left: 0; }
  .main { padding: 16px 16px 40px; padding-top: 56px; }
  .kpi-grid { grid-template-columns: repeat(2, 1fr); }
  .hook-grid { grid-template-columns: 1fr; }
  .hamburger { display: flex; }
}
.hamburger {
  display: none; position: fixed; top: 14px; left: 14px; width: 40px; height: 40px;
  background: var(--card); border: 1px solid var(--line); border-radius: 10px; cursor: pointer;
  align-items: center; justify-content: center; font-size: 18px; z-index: 200; box-shadow: var(--shadow);
}
.overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.35); z-index: 99; }
.overlay.visible { display: block; }
/* ── 인라인 SVG 차트 ── */
.svg-chart { width: 100%; height: auto; display: block; }
.svg-empty { font-size: 12px; color: var(--muted); padding: 18px 4px; text-align: center; }
/* ── 정식 지표(A) ── */
.metric-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
.metric-cell { background: var(--soft); border: 1px solid var(--line); border-radius: 10px; padding: 12px 10px; text-align: center; }
.metric-label { font-size: 11px; color: var(--muted); font-weight: 600; margin-bottom: 6px; }
.metric-val { font-size: 22px; font-weight: 800; letter-spacing: -.02em; }
.metric-val.blue { color: var(--blue); }
.metric-val.green { color: var(--green); }
.metric-val.orange { color: var(--orange); }
.metric-val.purple { color: var(--purple); }
.metric-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.metric-chip { font-size: 11px; color: var(--sub); background: var(--soft); border: 1px solid var(--line); border-radius: 7px; padding: 3px 8px; }
.metric-chip b { color: var(--text); font-weight: 800; }
@media (max-width: 600px) { .metric-grid { grid-template-columns: repeat(2, 1fr); } }
/* ── ④ 경쟁 벤치마크 ── */
.group-head { font-size: 16px; font-weight: 800; letter-spacing: -.02em; margin: 8px 0 12px; }
.group-sub { font-size: 11px; font-weight: 400; color: var(--muted); }
/* 우리 vs 경쟁 */
.vs-row { padding: 12px 0; border-top: 1px solid var(--line); }
.vs-row:first-child { border-top: 0; padding-top: 0; }
.vs-row.weak { background: var(--red-soft); border-radius: 10px; padding: 12px; border-top: 0; margin-bottom: 4px; }
.vs-topic { font-size: 13px; font-weight: 700; margin-bottom: 8px; }
.vs-weak { font-size: 10px; font-weight: 700; color: var(--red); background: #fff; border-radius: 5px; padding: 1px 6px; }
.vs-bars { display: flex; flex-direction: column; gap: 5px; }
.vs-bar-line { display: flex; align-items: center; gap: 8px; }
.vs-tag { font-size: 10px; font-weight: 700; width: 64px; flex-shrink: 0; }
.vs-tag.ours { color: var(--blue); }
.vs-tag.comp { color: var(--orange); }
.vs-track { flex: 1; height: 13px; background: var(--soft); border-radius: 5px; overflow: hidden; }
.vs-fill { height: 100%; border-radius: 5px; min-width: 2px; }
.vs-fill.ours { background: var(--blue); }
.vs-fill.comp { background: var(--orange); }
.vs-num { width: 48px; text-align: right; font-size: 11px; font-weight: 700; }
/* 갭 소재 */
.gap-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.gap-chip { background: var(--yellow-soft); border: 1px solid #F2E6B0; border-radius: 10px; padding: 12px; }
.gap-topic { font-size: 13px; font-weight: 800; color: #8A6D00; margin-bottom: 4px; }
.gap-meta { font-size: 11px; color: var(--sub); margin-bottom: 6px; }
.gap-meta b { color: var(--red); }
.gap-sample { font-size: 11px; color: var(--muted); line-height: 1.4; }
@media (max-width: 600px) { .gap-grid { grid-template-columns: 1fr; } }
/* 경쟁 글 카드 */
.comp-list { display: flex; flex-direction: column; gap: 10px; }
.comp-card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; box-shadow: var(--shadow); }
.comp-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.comp-src { font-size: 12px; font-weight: 800; color: var(--text); }
.comp-plat { font-size: 10px; font-weight: 700; color: var(--muted); background: var(--soft); border-radius: 5px; padding: 1px 6px; }
.comp-text { font-size: 13px; line-height: 1.5; color: var(--sub); margin-bottom: 8px; }
.comp-ko { font-size: 12.5px; line-height: 1.55; color: var(--text); background: var(--blue-soft); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
.comp-ko-tag { font-size: 9px; font-weight: 800; color: #fff; background: var(--blue); border-radius: 4px; padding: 1px 5px; margin-right: 6px; vertical-align: middle; }
.comp-stats { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.cstat { font-size: 11px; color: var(--muted); }
.cstat b { font-size: 14px; font-weight: 800; color: var(--text); margin-right: 3px; }
.comp-link { font-size: 11px; color: var(--blue); text-decoration: none; margin-left: auto; }
/* 훅 구조 요약 */
.hook-sum-row { padding: 12px 0; border-top: 1px solid var(--line); }
.hook-sum-row:first-of-type { border-top: 0; padding-top: 6px; }
.hook-sum-name { font-size: 13px; font-weight: 700; margin-bottom: 6px; }
.hook-ex { font-size: 11.5px; color: var(--sub); line-height: 1.5; margin-bottom: 3px; }
/* ── 오늘의 레퍼런스(④ 메인) ── */
.ref-card { background: linear-gradient(160deg, #FFFFFF 0%, #F4F8FF 100%); border-color: #CFE3FF; }
.ref-head { border-bottom: 1px solid var(--line); padding-bottom: 14px; margin-bottom: 16px; }
.ref-eyebrow { font-size: 12px; font-weight: 700; color: var(--blue-strong); letter-spacing: -.01em; }
.ref-date { font-size: 11px; font-weight: 600; color: var(--muted); margin-left: 6px; }
.ref-kw { font-size: 30px; font-weight: 800; letter-spacing: -.03em; color: var(--text); margin-top: 6px; line-height: 1.1; }
.ref-kw-desc { font-size: 13px; color: var(--sub); margin-top: 4px; }
.ref-post { }
.ref-src-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.ref-src { font-size: 14px; font-weight: 800; color: var(--text); }
.ref-when { font-size: 11px; font-weight: 600; color: var(--muted); background: var(--soft); border-radius: 5px; padding: 1px 7px; }
.ref-when-recent { color: var(--orange); background: var(--orange-soft); }
.ref-text { font-size: 15px; line-height: 1.6; color: var(--text); margin-bottom: 12px; font-weight: 500; }
.ref-ko { font-size: 14px; line-height: 1.65; color: var(--text); background: var(--blue-soft); border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; }
.ref-stats { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
.ref-stats .cstat b { font-size: 16px; }
.ref-apply { border-radius: 12px; padding: 14px 16px; }
.ref-apply-gap { background: var(--orange-soft); border: 1px solid #FFDFAE; }
.ref-apply-weak { background: var(--yellow-soft); border: 1px solid #F2E6B0; }
.ref-apply-strong { background: var(--green-soft); border: 1px solid #BFEAD2; }
.ref-apply-title { font-size: 12px; font-weight: 800; color: var(--text); margin-bottom: 5px; }
.ref-apply-body { font-size: 13px; line-height: 1.6; color: var(--sub); }
.ref-empty { font-size: 13px; color: var(--sub); line-height: 1.7; padding: 18px 4px; }
.ref-nav { display: flex; justify-content: space-between; gap: 10px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
.ref-nav-item { font-size: 12px; color: var(--muted); }
.ref-nav-item b { color: var(--sub); font-weight: 700; }
.ref-kw-index { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.ref-kw-chip { font-size: 11px; font-weight: 600; color: var(--muted); background: var(--soft); border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; }
.ref-kw-chip.on { background: var(--blue); border-color: var(--blue); color: #fff; font-weight: 800; }
</style>
</head>
<body>

<div class="overlay" id="overlay" onclick="closeSidebar()"></div>
<button class="hamburger" onclick="toggleSidebar()">☰</button>

<div class="app">
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-logo">
      <span>Meta</span> Insights
      <span class="updated">${esc(updated)} 기준 · 실데이터</span>
    </div>
    <div class="acct-switch">
      <div class="acct-label">계정</div>
      <div class="acct-btns">${acctBtns}</div>
    </div>
    <div class="ch-switch">
      <div class="ch-label">채널</div>
      <div class="ch-btns">${chBtns}</div>
    </div>
    <nav class="nav-section">
      <div class="nav-label">분석 흐름 (원본 → 분석 → 액션)</div>
      ${navItems}
    </nav>
  </aside>

  <main class="main" id="main-content">
${sectionsHtml}
  </main>
</div>

<script>
// ── 상태 ──  sec = 뎁스(data | analysis | action)
var state = { acct: '${esc(first.id)}', ch: 'threads', sec: 'data' };

function viewId(sec) {
  return 'view-' + state.acct + '-' + state.ch + '-' + sec;
}

function showCurrentView() {
  document.querySelectorAll('.acct-ch-view').forEach(function(el) { el.classList.remove('active'); });
  var el = document.getElementById(viewId(state.sec));
  if (el) el.classList.add('active');
}

function switchSec(btn) {
  document.querySelectorAll('.nav-item').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  var sec = btn.dataset.sec;
  document.querySelectorAll('.section').forEach(function(s) { s.classList.remove('active'); });
  document.getElementById('sec-' + sec).classList.add('active');
  state.sec = sec;
  showCurrentView();
  if (window.innerWidth <= 768) closeSidebar();
}

function switchAcct(btn) {
  document.querySelectorAll('.acct-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  state.acct = btn.dataset.acct;
  showCurrentView();
}

function switchCh(btn) {
  document.querySelectorAll('.ch-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  state.ch = btn.dataset.ch;
  showCurrentView();
}

// ── 성장 추이 그란 토글 ──
function switchGran(btn) {
  var row = btn.closest('.gran-row');
  row.querySelectorAll('.gran-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  var idx = Array.from(row.querySelectorAll('.gran-btn')).indexOf(btn);
  var card = btn.closest('.card');
  card.querySelectorAll('.data-block').forEach(function(b, i) { b.classList.toggle('active', i === idx); });
}

// ── 원본 글 목록 정렬 토글 (data-sortkey 별 내림차순) ──
// 같은 행 안에서만 active 토글, 정렬 대상은 가장 가까운 [data-sortlist] 컨테이너.
function sortPosts(btn) {
  var row = btn.closest('.sort-row');
  if (row) row.querySelectorAll('.sort-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  var key = btn.getAttribute('data-sortkey');
  // 같은 acct-ch-view 안의 정렬리스트만 건드린다(다른 계정×채널 뷰에 영향 X).
  var scope = btn.closest('.acct-ch-view') || document;
  var list = scope.querySelector('[data-sortlist]');
  if (!list) return;
  var cards = Array.prototype.slice.call(list.querySelectorAll('.post-card'));
  var getN = function(el) {
    var v = parseFloat(el.getAttribute('data-' + key));
    return isNaN(v) ? 0 : v;
  };
  cards.sort(function(a, b) { return getN(b) - getN(a); });
  cards.forEach(function(c) { list.appendChild(c); });
}

// ── 모바일 사이드바 ──
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('visible');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('visible');
}

// 초기 뷰 동기화(첫 계정·threads·summary)
showCurrentView();
</script>
</body>
</html>`;
}
