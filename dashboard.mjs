// dashboard.mjs — 엔트리: accounts.json 로드 → 계정×채널 fetch → 캐시 누적 → logic 조립 → render → dashboard.html
// 실행:  node dashboard.mjs   (Node 22+, 내장 fetch 사용 / 외부 의존성 0)

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadAccounts, fetchThreads, fetchInstagram, fetchThreadsAccount, fetchInstagramAccount,
  mergePostsCache, snapshotAccount, loadSnapshots,
} from "./src/data.mjs";
import {
  enrich, detectBreakouts, rankPosts, summarize, topicFormatMatrix, hookPerformance,
  recommend, bucketBreakdown, dailyLog, followerBuckets,
  rankByScore, recommendFromScores,
  enrichCompetitorPosts, topicGapAnalysis, competitorHookSummary, worthAnalyzing, splitCompetitorGroups,
  dailyReference, referenceNeighbors, applyPoint,
} from "./src/logic.mjs";
import {
  crawlAllCompetitors, loadCompetitorsCache, mergeCompetitorsCache, pickForTranslation, translatePicks,
} from "./src/competitors.mjs";
import { renderDashboard } from "./src/render.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));

// 한 계정×채널 분량을 독립적으로 분석 (교차 비교 없음 → 정규화 불필요)
// 3뎁스 흐름(원본→분석→액션)에 맞춰 각 단계가 쓸 데이터를 모두 산출한다.
function buildPlatform(label, status, posts, followers) {
  const bo = detectBreakouts(posts);
  const ranked = rankPosts(bo);           // 뎁스1: 원본 정렬(참여수)
  const scoreRanked = rankByScore(bo);    // 뎁스2: 가중치 점수 랭킹
  return {
    label,
    status,
    count: bo.length,
    summary: summarize(bo, followers),
    trends: { day: bucketBreakdown(bo, "day"), week: bucketBreakdown(bo, "week"), month: bucketBreakdown(bo, "month") },
    log: dailyLog(bo),
    ranked,
    scoreRanked,                          // 뎁스2 점수 표/카드
    matrix: topicFormatMatrix(bo),
    hooks: hookPerformance(bo),
    recommendations: recommend(bo),       // (참고용 NER 추천 — 사용 안 해도 보존)
    scoreRecs: recommendFromScores(bo),   // 뎁스3 점수 기반 액션플랜
    breakouts: ranked.filter((p) => p.is_breakout),
  };
}

// content-recommendations.json 큐레이션 로드.
// 신규(멀티계정) 포맷:  { accounts: { <id>: { threads:{...}, instagram:{...} } } }
// 레거시 포맷:          { threads:{...}, instagram:{...} }  → bbopters 로 간주
function loadCurated(root) {
  const f = join(root, "content-recommendations.json");
  if (!existsSync(f)) return {};
  let raw;
  try { raw = JSON.parse(readFileSync(f, "utf8")); } catch { return {}; }
  if (raw.accounts && typeof raw.accounts === "object") return raw.accounts;
  // 레거시 → bbopters 매핑
  if (raw.threads || raw.instagram) return { bbopters: { threads: raw.threads || null, instagram: raw.instagram || null } };
  return {};
}

function folHist(snaps, key) {
  return {
    day: followerBuckets(snaps, key, "day"),
    week: followerBuckets(snaps, key, "week"),
    month: followerBuckets(snaps, key, "month"),
  };
}

async function main() {
  const accounts = loadAccounts();
  if (!accounts.length) {
    console.error("❌ accounts.json 에 계정이 없습니다.");
    process.exit(1);
  }
  console.log(`⏳ ${accounts.length}개 계정 데이터 수집 중…`);

  const curated = loadCurated(ROOT);
  // 오늘 날짜(KST, YYYY-MM-DD) — "오늘의 레퍼런스" 키워드 로테이션 기준(결정적).
  const todayStr = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const results = [];

  for (const account of accounts) {
    // 계정당 4개 fetch 병렬
    const [threads, instagram, thAcc, igAcc] = await Promise.all([
      fetchThreads(account),
      fetchInstagram(account),
      fetchThreadsAccount(account),
      fetchInstagramAccount(account),
    ]);

    // 캐시 누적(글마다 account 태그 포함됨)
    mergePostsCache([...threads.posts, ...instagram.posts]);
    // 팔로워 시점 스냅샷(계정 차원)
    snapshotAccount(account, { ...(thAcc || {}), ...(igAcc || {}) });

    console.log(
      `   [${account.id}] Threads ${threads.ok ? `✅ ${threads.posts.length}개` : `⏭ ${threads.reason}`}` +
      ` · Instagram ${instagram.ok ? `✅ ${instagram.posts.length}개` : `⏭ ${instagram.reason}`}` +
      ` · 팔로워 Threads ${thAcc?.threads_followers ?? "–"} / IG ${igAcc?.ig_followers ?? "–"}`
    );

    results.push({ account, threads, instagram, thAcc, igAcc });
  }

  // ── 경쟁사 크롤(토큰X) → competitors-cache 누적 ──
  console.log(`⏳ 경쟁사 크롤 중(X·Threads, 토큰 없이)…`);
  let compReport = { x: {}, threads: {}, collected: 0, cacheTotal: 0 };
  try {
    const { report } = await crawlAllCompetitors();
    compReport = report;
    console.log(`   X: ${JSON.stringify(report.x)}`);
    console.log(`   Threads: ${JSON.stringify(report.threads)}`);
    console.log(`   이번 수집 ${report.collected}개 · 캐시 누적 ${report.cacheTotal}개`);
  } catch (e) {
    console.log(`   ⚠️ 경쟁 크롤 일부 실패(캐시 보존): ${e.message}`);
  }
  // 번역 필요 글(해외 상위 5/계정) — 캐시에 text_ko 없으면 후보. 무료 구글번역으로 자동 채움(LLM 키 X).
  const compRaw = enrichCompetitorPosts(Object.values(loadCompetitorsCache().posts));
  const translationPicks = pickForTranslation(compRaw, 5);
  if (translationPicks.length) {
    console.log(`   📝 무료 자동번역 대기 ${translationPicks.length}개(해외 상위, text_ko 미생성)…`);
    try {
      const tr = await translatePicks(translationPicks, { gapMs: 300 });
      console.log(`   🌐 번역 완료 ${tr.translated}개 · 실패 ${tr.failed}개(원문 유지).`);
    } catch (e) {
      console.log(`   ⚠️ 번역 일부 실패(원문 유지): ${e.message}`);
    }
  } else {
    console.log(`   🌐 번역 최신 — 새로 번역할 해외 상위글 없음.`);
  }

  // 누적 캐시 전체를 한 번 enrich → 계정×채널로 필터링
  const cacheAll = mergePostsCache([]); // 추가 글 없이 전체 누적본 반환
  const snaps = loadSnapshots();

  // 정식 지표 분모 폴백용 팔로워(계정:채널) 맵
  const followersByKey = {};
  for (const { account, thAcc, igAcc } of results) {
    if (thAcc?.threads_followers != null) followersByKey[`${account.id}:threads`] = thAcc.threads_followers;
    if (igAcc?.ig_followers != null) followersByKey[`${account.id}:instagram`] = igAcc.ig_followers;
  }
  const enriched = enrich(cacheAll, followersByKey);
  console.log(`   누적 캐시 : ${enriched.length}개`);

  // 경쟁 글(번역 캐시 반영본) 분류 — 한 번만
  const compEnriched = enrichCompetitorPosts(Object.values(loadCompetitorsCache().posts));
  const compGroups = splitCompetitorGroups(compEnriched);

  const accountViews = results.map(({ account, threads, instagram, thAcc, igAcc }) => {
    const acctPosts = enriched.filter((p) => (p.account?.id || "bbopters") === account.id);
    const thPosts = acctPosts.filter((p) => p.platform === "threads");
    const igPosts = acctPosts.filter((p) => p.platform === "instagram");
    const acctSnaps = snaps.filter((s) => (s.account?.id || "bbopters") === account.id);

    const thPlatform = buildPlatform("Threads", threads, thPosts, thAcc?.threads_followers);
    const igPlatform = buildPlatform("Instagram", instagram, igPosts, igAcc?.ig_followers);

    const cur = curated[account.id] || {};
    thPlatform.curated = cur.threads || null;
    igPlatform.curated = cur.instagram || null;
    thPlatform.followerHistory = folHist(acctSnaps, "threads_followers");
    igPlatform.followerHistory = folHist(acctSnaps, "ig_followers");

    // ── ④ 경쟁 벤치마크 — "오늘의 레퍼런스"(키워드별 하루 1개) 메인 + 보조 분석 ──
    // Threads 채널은 국내 Threads 직접비교 + 해외 영감 모두, IG 채널도 동일 경쟁풀(소재 아이디어 차원).
    const buildBench = (ourPosts) => {
      if (!compEnriched.length) return { totalCompetitorPosts: 0, ourCount: ourPosts.length };
      const { common, gap } = topicGapAnalysis(ourPosts, compEnriched);
      // 오늘의 레퍼런스(결정적): 날짜로 키워드 1개 → 그 키워드 해외 베스트 글 1개 + 우리 적용포인트.
      const reference = dailyReference(compEnriched, todayStr);
      const refNeighbors = referenceNeighbors(todayStr);
      const refApply = reference.keyword ? applyPoint(reference.keyword, ourPosts) : null;
      return {
        totalCompetitorPosts: compEnriched.length,
        ourCount: ourPosts.length,
        reference,        // { keyword, desc, post|null, count }
        refNeighbors,     // { yesterday, today, tomorrow }
        refApply,         // { keyword, ourCount, level, sentence }
        todayStr,
        common,
        gap,
        sameKr: compGroups.sameKr,
        overseas: compGroups.overseas,
        hookSummary: competitorHookSummary(compEnriched, { topN: 12 }),
        worth: worthAnalyzing(ourPosts, compEnriched, { max: 5 }),
      };
    };
    thPlatform.bench = buildBench(thPosts);
    igPlatform.bench = buildBench(igPosts);

    return {
      id: account.id,
      label: account.label,
      handle: account.handle || account.instagram?.username || "",
      threads: thPlatform,
      instagram: igPlatform,
    };
  });

  // AI 콘텐츠 레이더 — community-radar(시고르 24시간 수집)의 analyzed.json. 없으면 graceful.
  let radar = null;
  try {
    const radarPath = process.env.RADAR_DATA || join(ROOT, "data/analyzed.json");
    radar = JSON.parse(readFileSync(radarPath, "utf-8"));
  } catch {
    console.warn("[radar] 레이더 데이터 없음(RADAR_DATA env 또는 data/analyzed.json) — AI 레이더 탭은 빈 상태로 렌더");
  }
  const html = renderDashboard({ generatedAt: new Date().toISOString(), accounts: accountViews, radar });

  const out = join(ROOT, "dashboard.html");
  writeFileSync(out, html, "utf8");
  console.log(`\n✅ 생성 완료: ${out}`);
  console.log(`   브라우저로 열기:  open "${out}"`);
}

main().catch((e) => {
  console.error("❌ 실패:", e.message);
  process.exit(1);
});
