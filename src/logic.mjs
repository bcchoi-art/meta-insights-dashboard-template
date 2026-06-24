// logic.mjs — Logic 계층: 태깅 + 점수(NER) + 가중치 점수 + 브레이크아웃 + 추천 (순수 함수, I/O 없음)

// ───────────────────────── 가중치 점수 엔진 (편집 쉬운 상수) ─────────────────────────
// 게시물 가치 = Σ(지표 × 가중치). 퍼지는 신호(공유·리포스트·인용)에 높은 가중치.
// 여기 숫자만 바꾸면 뎁스2 점수 랭킹·뎁스3 추천이 전부 같이 움직인다.
export const SCORE_WEIGHTS = {
  instagram: { likes: 1, comments: 2, saved: 3, shares: 4 },
  threads:   { likes: 1, replies: 2, reposts: 3, quotes: 3, shares: 4 },
};

// 한 게시물의 가중치 총점 + 점수 구성 분해.
// 인사이트(insights)가 있으면 그걸 쓰고, 없으면 글 자체에 박힌 like_count/comments_count 로 폴백.
// 반환: { total, parts:[{ metric, label, count, weight, points }] }  (못 매길 글이면 null)
export function scorePost(post, platform) {
  const pf = platform || post.platform;
  const weights = SCORE_WEIGHTS[pf];
  if (!weights) return null;
  const i = post.insights || {};

  // 지표명 → 라벨(비전공자 톤) + 폴백 값 추출
  const LABELS = {
    likes: "좋아요", comments: "댓글", saved: "저장", shares: "공유",
    replies: "답글", reposts: "리포스트", quotes: "인용",
  };
  const valueOf = (metric) => {
    switch (metric) {
      case "likes":    return i.likes ?? post.like_count ?? 0;
      case "comments": return i.comments ?? post.comments_count ?? 0;
      case "saved":    return i.saved ?? 0;
      case "shares":   return i.shares ?? 0;
      case "replies":  return i.replies ?? 0;
      case "reposts":  return i.reposts ?? 0;
      case "quotes":   return i.quotes ?? 0;
      default:         return i[metric] ?? 0;
    }
  };

  const parts = [];
  let total = 0;
  for (const [metric, weight] of Object.entries(weights)) {
    const count = valueOf(metric);
    const points = count * weight;
    total += points;
    parts.push({ metric, label: LABELS[metric] || metric, count, weight, points });
  }
  return { total, parts };
}

// 점수 랭킹: 글 배열에 score(=scorePost) 부착 → 총점 내림차순. 평균 대비 우수 글 플래그.
// 반환: [{ ...post, score:{total,parts}, scoreTotal, aboveAvg, scoreMultiple }]  (점수 못 매긴 글은 제외)
export function rankByScore(posts) {
  const scored = posts
    .map((p) => {
      const score = scorePost(p, p.platform);
      return score ? { ...p, score, scoreTotal: score.total } : null;
    })
    .filter(Boolean);
  if (!scored.length) return [];
  const avg = mean(scored.map((p) => p.scoreTotal)) || 0;
  return scored
    .map((p) => ({
      ...p,
      aboveAvg: avg > 0 && p.scoreTotal > avg,
      scoreMultiple: avg > 0 ? p.scoreTotal / avg : null,
    }))
    .sort((a, b) => b.scoreTotal - a.scoreTotal || new Date(b.timestamp) - new Date(a.timestamp));
}

// 점수 기반 추천: 고득점 글(상위 N)에서 주제·포맷·훅 패턴 빈도 추출 → "다음에 이 소재/훅으로" 카드.
// deterministic — 동일 입력이면 동일 출력. 각 카드에 근거(어느 우수 글에서 왔는지) 포함.
export function recommendFromScores(posts, { topN = 8, max = 3 } = {}) {
  const ranked = rankByScore(posts);
  if (ranked.length < 2) return [];
  const top = ranked.slice(0, Math.min(topN, ranked.length));

  // (주제 × 포맷) 조합별 집계 — 고득점 글이 모인 조합이 강한 소재.
  const groups = {};
  for (const p of top) {
    for (const t of p.topics || []) {
      if (t === "ETC") continue;
      const key = `${t}|${p.media_type}`;
      const g = (groups[key] ??= {
        topic: t, format: p.media_type, scores: [], hooks: {}, samples: [],
      });
      g.scores.push(p.scoreTotal);
      g.hooks[p.hook_type] = (g.hooks[p.hook_type] || 0) + 1;
      g.samples.push({ text: p.hook_text || (p.text || "").slice(0, 42), score: p.scoreTotal });
    }
  }

  const cards = Object.values(groups).map((g) => {
    const avgScore = mean(g.scores) || 0;
    const bestHook = Object.entries(g.hooks).sort((a, b) => b[1] - a[1])[0]?.[0] || "OTHER";
    const bestSample = g.samples.slice().sort((a, b) => b.score - a.score)[0];
    return {
      topic: g.topic,
      format: g.format,
      hook: bestHook,
      avgScore,
      count: g.scores.length, // 상위권에 이 조합이 몇 번 등장했나
      sampleText: bestSample?.text || "",
      sampleScore: bestSample?.score || 0,
    };
  });
  // 상위권 등장 횟수 × 평균 점수로 정렬(자주 + 높게 먹힌 조합 우선)
  cards.sort((a, b) => b.count * b.avgScore - a.count * a.avgScore);
  return cards.slice(0, max);
}

// ───────────────────────── 통계 헬퍼 ─────────────────────────
const nums = (arr) => arr.filter((x) => x != null && !Number.isNaN(x));
const median = (arr) => {
  const a = nums(arr).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const mean = (arr) => {
  const a = nums(arr);
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
};
const stdev = (arr) => {
  const a = nums(arr);
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
};

// ───────────────────────── 텍스트 파생(룰 기반 태깅) ─────────────────────────
const TOPIC_RULES = [
  ["TROUBLESHOOT", /(에러|오류|충돌|안\s?됨|안되|해결|트러블|날렸|날림|먹통|꼬여|꼬임|버그|삽질)/],
  ["PROMPT_SHARE", /(프롬프트|prompt|복붙|복사해서|이 프롬프트|아래.{0,6}프롬프트)/i],
  ["AUTOMATION_HOW", /(자동화|워크플로우|workflow|n8n|헤르메스|hermes|오픈클로|cron|웹훅|webhook|스크립트)/i],
  ["TOOL_INTRO", /(도구|툴|tool|소개|써봤|써보니|신기능|출시|클로드|claude|gpt|코덱스|codex)/i],
  ["CASE_STUDY", /(사례|실험|해봤|후기|결과|적용해|만들어봤|써봤다)/],
  ["COMMUNITY", /(여러분|질문\s?주세요|알려주세요|어떻게 생각|덕후방|입문방|놀러|댓글로)/],
];

function detectTopics(text) {
  const topics = [];
  for (const [tag, re] of TOPIC_RULES) if (re.test(text)) topics.push(tag);
  return topics.length ? topics : ["ETC"];
}

function detectHook(text) {
  const first = (text.split(/[\n.!?。]/).find((s) => s.trim()) || text).trim();
  let type = "OTHER";
  if (/(날렸|망했|실패|힘들|고생|삽질|멘붕|소리.{0,2}났|무서워|답답|헉|충돌)/.test(first)) type = "PAIN";
  else if (/\d/.test(first)) type = "NUMBER";
  else if (/\?/.test(text.slice(0, 60))) type = "QUESTION";
  else if (/(어떻게|방법|하는 법|이렇게 하면|하면 된다|분 만에|분이면|3분|1분)/.test(first)) type = "HOW_TO";
  else if (/(사실|진짜|오히려|의외로|아무도|대부분|이유|비밀|함정)/.test(first)) type = "CLAIM";
  else if (/(저도|처음|예전|어느 날|있었|하다가)/.test(first)) type = "STORY";
  return { hook_type: type, hook_text: first.slice(0, 42) };
}

function lengthInfo(text) {
  const wc = (text.trim().match(/\S+/g) || []).length;
  return { word_count: wc, length_bucket: wc <= 50 ? "Short" : wc <= 150 ? "Mid" : "Long" };
}

// ───────────────────────── 점수(NER) ─────────────────────────
// NER = 가중 참여 / 노출 × 100. 퍼지는 신호(리포스트·인용·공유)에 높은 가중치.
export function computeNER(post) {
  const i = post.insights;
  if (post.platform === "threads") {
    if (!i || !i.views) return null;
    const { views = 0, likes = 0, replies = 0, reposts = 0, quotes = 0, shares = 0 } = i;
    if (views <= 0) return null;
    return ((likes + replies * 3 + reposts * 5 + quotes * 4 + shares * 5) / views) * 100;
  }
  const reach = i?.reach;
  if (!reach) return null;
  const likes = i?.likes ?? post.like_count ?? 0;
  const comments = i?.comments ?? post.comments_count ?? 0;
  const saved = i?.saved ?? 0;
  const shares = i?.shares ?? 0;
  return ((likes + comments * 3 + saved * 4 + shares * 5) / reach) * 100;
}

function reachOf(post) {
  return post.platform === "threads" ? post.insights?.views ?? null : post.insights?.reach ?? null;
}

// 획득 신호(밖으로 퍼짐) vs 리텐션 신호(기존 팔로워 반응)
function signalsOf(post) {
  const i = post.insights || {};
  if (post.platform === "threads") {
    return { acquisition: (i.reposts || 0) + (i.quotes || 0) + (i.shares || 0), retention: i.replies || 0 };
  }
  return {
    acquisition: i.shares || 0,
    retention: (i.saved || 0) + (i.comments ?? post.comments_count ?? 0),
  };
}

// ───────────────────────── 정식 지표(A) ─────────────────────────
// 업계 표준 비율 지표. 분모 우선순위: 도달(reach) → 없으면 조회(views) → 없으면 팔로워.
// 반환: { totalInteractions, denom, denomKind, engagementRate, saveRate, shareRate, viralCoeff }
//   - engagementRate = 총상호작용 ÷ 분모 × 100
//   - saveRate       = 저장 ÷ 분모 × 100         (IG 만 의미. threads 는 null)
//   - shareRate      = 공유 ÷ 분모 × 100
//   - viralCoeff     = (공유 or 리포스트+인용) ÷ 분모 × 100  (밖으로 퍼진 비율)
export function formalMetrics(post, followers = null) {
  const i = post.insights || {};
  const isTh = post.platform === "threads";

  const likes = i.likes ?? post.like_count ?? 0;
  const comments = i.comments ?? i.replies ?? post.comments_count ?? 0;
  const saved = i.saved ?? 0;
  const shares = i.shares ?? 0;
  const reposts = i.reposts ?? 0;
  const quotes = i.quotes ?? 0;

  const totalInteractions = isTh
    ? likes + comments + reposts + quotes + shares
    : (i.total_interactions ?? (likes + comments + saved + shares));

  // 분모 선택
  const reach = isTh ? (i.views ?? null) : (i.reach ?? null);
  let denom = reach;
  let denomKind = isTh ? "조회" : "도달";
  if (denom == null || denom <= 0) {
    denom = followers && followers > 0 ? followers : null;
    denomKind = "팔로워";
  }
  if (denom == null || denom <= 0) {
    return { totalInteractions, denom: null, denomKind, engagementRate: null, saveRate: null, shareRate: null, viralCoeff: null };
  }

  const viralNum = isTh ? (reposts + quotes + shares) : shares;
  return {
    totalInteractions,
    denom,
    denomKind,
    engagementRate: (totalInteractions / denom) * 100,
    saveRate: isTh ? null : (saved / denom) * 100,
    shareRate: (shares / denom) * 100,
    viralCoeff: (viralNum / denom) * 100,
  };
}

// 벤치마킹: 이 계정×채널 안에서 각 글의 인게이지먼트율이 평균 대비 몇 배 / 백분위인지.
// posts 는 enrich 된 동일 채널 글 배열. metrics(formalMetrics 결과)가 붙어 있어야 함.
// 각 글에 { erMultiple, erPercentile } 부여(분모 없는 글은 null).
export function benchmarkWithin(posts) {
  const ers = posts.map((p) => p.metrics?.engagementRate).filter((x) => x != null && !Number.isNaN(x));
  const avgER = mean(ers);
  const sorted = ers.slice().sort((a, b) => a - b);
  return posts.map((p) => {
    const er = p.metrics?.engagementRate;
    if (er == null || avgER == null || avgER <= 0) return { ...p, erMultiple: null, erPercentile: null };
    const below = sorted.filter((x) => x <= er).length;
    const pct = sorted.length ? Math.round((below / sorted.length) * 100) : null;
    return { ...p, erMultiple: er / avgER, erPercentile: pct };
  });
}

// ───────────────────────── 파이프라인 ─────────────────────────
export function enrich(posts, followersByKey = {}) {
  return posts.map((p) => {
    const text = p.text || "";
    const topics = detectTopics(text);
    const hook = detectHook(text);
    const sig = signalsOf(p);
    const ix = p.insights || {};
    // 절대 참여수(횟수 합) — 도달로 안 나눠서 저도달 글이 부풀려지지 않음. 메인 점수.
    const eng = (ix.likes ?? p.like_count ?? 0) + (ix.comments ?? ix.replies ?? p.comments_count ?? 0) + (ix.saved ?? 0) + (ix.shares ?? 0) + (ix.reposts ?? 0) + (ix.quotes ?? 0);
    // 정식 지표 — 분모 폴백용 팔로워는 계정×채널 키로 전달
    const folKey = `${p.account?.id || "bbopters"}:${p.platform}`;
    const metrics = formalMetrics(p, followersByKey[folKey] ?? null);
    return {
      ...p,
      reach: reachOf(p),
      ner: computeNER(p),
      eng,
      metrics,
      topics,
      primary_topic: topics[0],
      hook_type: hook.hook_type,
      hook_text: hook.hook_text,
      ...lengthInfo(text),
      ...sig,
    };
  });
}

// 채널별로 따로 분석하므로 교차 정규화 불필요 — 각 채널 안에서 raw NER 사용
export function detectBreakouts(posts) {
  const reaches = posts.map((p) => p.reach);
  const threshold = (median(reaches) ?? 0) + 2 * stdev(reaches);
  const enough = nums(reaches).length >= 5;
  return posts.map((p) => ({ ...p, is_breakout: enough && p.reach != null && p.reach > threshold }));
}

export function rankPosts(posts) {
  return posts.slice().sort((a, b) => {
    const an = a.eng ?? -1, bn = b.eng ?? -1;
    if (bn !== an) return bn - an;
    return new Date(b.timestamp) - new Date(a.timestamp);
  });
}

export function summarize(posts, followers = null) {
  return {
    count: posts.length,
    totalLikes: posts.reduce((s, p) => s + (p.insights?.likes ?? p.like_count ?? 0), 0),
    totalSaves: posts.reduce((s, p) => s + (p.insights?.saved || 0), 0),
    totalShares: posts.reduce((s, p) => s + ((p.insights?.shares || 0) + (p.insights?.reposts || 0) + (p.insights?.quotes || 0)), 0),
    totalReach: posts.reduce((s, p) => s + (p.reach || 0), 0),
    followers,
  };
}

// 월별 집계 — 타임스탬프 기반 시계열 (게시 수 · 총 조회/도달 · 중앙 NER · 획득)
export function monthlyBreakdown(posts) {
  const map = {};
  for (const p of posts) {
    if (!p.timestamp) continue;
    const m = p.timestamp.slice(0, 7); // YYYY-MM
    const g = (map[m] ??= { month: m, count: 0, reach: 0, ners: [], acquisition: 0 });
    g.count++;
    g.reach += p.reach || 0;
    if (p.ner != null) g.ners.push(p.ner);
    g.acquisition += p.acquisition || 0;
  }
  return Object.values(map)
    .map((g) => ({ month: g.month, count: g.count, totalReach: g.reach, medianNER: median(g.ners), totalAcquisition: g.acquisition }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

// 일/주/월 버킷 키 (KST 기준)
function bucketKey(ts, gran) {
  const kst = new Date(new Date(ts).getTime() + 9 * 3600 * 1000);
  const iso = kst.toISOString();
  if (gran === "month") return iso.slice(0, 7);
  if (gran === "day") return iso.slice(0, 10);
  const dow = (kst.getUTCDay() + 6) % 7; // 0=월요일
  const monday = new Date(kst);
  monday.setUTCDate(kst.getUTCDate() - dow);
  return monday.toISOString().slice(0, 10);
}

export function bucketBreakdown(posts, gran) {
  const map = {};
  for (const p of posts) {
    if (!p.timestamp) continue;
    const k = bucketKey(p.timestamp, gran);
    const ib = p.insights || {};
    const g = (map[k] ??= { bucket: k, count: 0, likes: 0, saved: 0, shares: 0, reach: 0 });
    g.count++;
    g.likes += ib.likes ?? p.like_count ?? 0;
    g.saved += ib.saved ?? 0;
    g.shares += (ib.shares ?? 0) + (ib.reposts ?? 0) + (ib.quotes ?? 0);
    g.reach += p.reach || 0;
  }
  return Object.values(map)
    .map((g) => ({ bucket: g.bucket, count: g.count, likes: g.likes, saved: g.saved, shares: g.shares, totalReach: g.reach }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

// 채널별로 실제 존재하는 insights 지표를 적응적으로 골라낸다.
// 반환: [{ field, label }] — field 는 insights/폴백에서 값을 뽑는 키, label 은 비전공자 라벨.
// (값이 한 글이라도 0보다 크면 "존재"로 본다 → 더미/미지원 지표 자동 스킵)
export function availableMetrics(posts, platform) {
  const isTh = platform === "threads";
  // 후보: [field, label, valueOf]  — threads/instagram 각각의 정의
  const candidates = isTh
    ? [
        ["views", "조회수", (i, p) => i.views ?? 0],
        ["likes", "좋아요", (i, p) => i.likes ?? p.like_count ?? 0],
        ["replies", "답글", (i) => i.replies ?? 0],
        ["reposts", "리포스트", (i) => i.reposts ?? 0],
        ["quotes", "인용", (i) => i.quotes ?? 0],
        ["shares", "공유", (i) => i.shares ?? 0],
      ]
    : [
        ["reach", "도달", (i) => i.reach ?? 0],
        ["views", "조회수", (i) => i.views ?? 0],
        ["likes", "좋아요", (i, p) => i.likes ?? p.like_count ?? 0],
        ["comments", "댓글", (i, p) => i.comments ?? p.comments_count ?? 0],
        ["saved", "저장", (i) => i.saved ?? 0],
        ["shares", "공유", (i) => i.shares ?? 0],
      ];
  const out = [];
  for (const [field, label, valueOf] of candidates) {
    const any = posts.some((p) => {
      const i = p.insights || {};
      return valueOf(i, p) > 0;
    });
    if (any) out.push({ field, label, valueOf });
  }
  return out;
}

// 단일 지표(field)를 발행일 기준 일/주/월 버킷으로 합산 → [{bucket, val}].
// valueOf(있으면)로 insights/폴백에서 값을 뽑는다. 없으면 insights[field] ?? 0.
export function metricBuckets(posts, field, gran, valueOf = null) {
  const pick = valueOf || ((i) => i[field] ?? 0);
  const map = {};
  for (const p of posts) {
    if (!p.timestamp) continue;
    const k = bucketKey(p.timestamp, gran);
    const i = p.insights || {};
    map[k] = (map[k] || 0) + (pick(i, p) || 0);
  }
  return Object.entries(map)
    .map(([bucket, val]) => ({ bucket, val }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket));
}

// 일별 활동 로그 (최근 우선) — 그 날 올린 글의 제목·주제·좋아요·도달
export function dailyLog(posts) {
  const map = {};
  for (const p of posts) {
    if (!p.timestamp) continue;
    const k = bucketKey(p.timestamp, "day");
    (map[k] ??= { date: k, items: [] }).items.push({
      title: (p.text || "").replace(/\n/g, " ").slice(0, 38),
      topics: p.topics,
      media_type: p.media_type,
      likes: p.insights?.likes ?? p.like_count ?? 0,
      reach: p.reach,
    });
  }
  return Object.values(map).sort((a, b) => b.date.localeCompare(a.date));
}

// 팔로워 스냅샷(6h 누적)을 KST 일/주/월 버킷으로 집계 — 각 버킷의 마지막 값을 '기간 종가'로 사용
export function followerBuckets(snaps, key, gran = "day") {
  const byB = {};
  for (const s of snaps || []) {
    const v = s[key];
    if (v == null) continue;
    const ts = s.at || `${s.date}T00:00:00Z`;
    const t = new Date(ts).getTime();
    const bk = bucketKey(ts, gran); // KST 기준 일/주(월요일)/월 키
    if (!byB[bk] || t >= byB[bk].t) byB[bk] = { bk, v, t };
  }
  return Object.values(byB)
    .sort((a, b) => a.bk.localeCompare(b.bk))
    .map((d) => ({ label: gran === "month" ? d.bk.slice(2) : d.bk.slice(5), v: d.v }));
}

// 주제 × 포맷 → {중앙 NER, 표본 수}
export function topicFormatMatrix(posts) {
  const map = {};
  for (const p of posts) {
    if (p.insights == null) continue;
    for (const t of p.topics) ((map[`${t}|${p.media_type}`] ??= []).push(p.eng));
  }
  const cells = {};
  for (const [key, vals] of Object.entries(map)) cells[key] = { value: median(vals), count: vals.length };
  return cells;
}

export function hookPerformance(posts) {
  const map = {};
  for (const p of posts) {
    if (p.insights == null) continue;
    (map[p.hook_type] ??= []).push(p.eng);
  }
  return Object.entries(map)
    .map(([hook, vals]) => ({ hook, value: median(vals), count: vals.length }))
    .sort((a, b) => b.value - a.value);
}

// 추천: 높은 NER 주제×포맷 조합 중 최근 미발행에 가산점
export function recommend(posts, { now = Date.now() } = {}) {
  const withEng = posts.filter((p) => p.insights != null);
  if (!withEng.length) return [];
  const overallMedian = median(withEng.map((p) => p.eng)) || 0;
  const DAY = 86400000;

  const groups = {};
  for (const p of withEng) {
    for (const t of p.topics) {
      if (t === "ETC") continue;
      const g = (groups[`${t}|${p.media_type}`] ??= { topic: t, format: p.media_type, ners: [], last: 0, hooks: {} });
      g.ners.push(p.eng);
      g.last = Math.max(g.last, new Date(p.timestamp).getTime());
      g.hooks[p.hook_type] = (g.hooks[p.hook_type] || 0) + 1;
    }
  }
  const K = 4; // 신뢰도 가중: 표본 적은 조합을 전체 중앙값 쪽으로 끌어당김(small-N 노이즈 억제)
  const cards = Object.values(groups).map((g) => {
    const m = median(g.ners);
    const count = g.ners.length;
    const daysSince = Math.floor((now - g.last) / DAY);
    const bestHook = Object.entries(g.hooks).sort((a, b) => b[1] - a[1])[0]?.[0] || "OTHER";
    return {
      topic: g.topic,
      format: g.format,
      hook: bestHook,
      value: m,
      adjustedNER: (count * m + K * overallMedian) / (count + K),
      multiple: overallMedian ? m / overallMedian : null,
      count,
      daysSince,
      gap: daysSince >= 14,
      lowSample: count < 3,
    };
  });
  cards.sort((a, b) => b.adjustedNER * (b.gap ? 1.2 : 1) - a.adjustedNER * (a.gap ? 1.2 : 1));
  return cards.slice(0, 3);
}

// ═════════════════════════════════════════════════════════════════════
// 경쟁 벤치마크 (D + E) — 우리 글 + 경쟁 글을 [소재·훅·포맷]으로 분류 후 갭/매칭 분석
// ═════════════════════════════════════════════════════════════════════

// 경쟁 글(competitors-cache 항목)에 우리와 동일한 룰 기반 태그를 부여.
// 경쟁 글 스키마: { account, platform(x|threads), lang, text, likes, reshares, replies, timestamp, url, text_ko }
export function enrichCompetitorPosts(posts) {
  return (posts || []).map((p) => {
    const text = p.text || "";
    const hook = detectHook(text);
    const eng = (p.likes || 0) + (p.reshares || 0) + (p.replies || 0);
    return {
      ...p,
      topics: detectTopics(text),
      primary_topic: detectTopics(text)[0],
      hook_type: hook.hook_type,
      hook_text: hook.hook_text,
      eng,
    };
  });
}

// 소재(topic)별로 우리 vs 경쟁 참여 비교 + 갭 소재 도출.
// ourPosts: enrich 된 우리 글(eng 보유). compPosts: enrichCompetitorPosts 결과.
// 반환:
//   { common: [{topic, ourCount, ourAvgEng, compCount, compAvgEng, weak}],
//     gap:    [{topic, compCount, compAvgEng, topSample}] }   // 우리 0건 = 시도 후보
export function topicGapAnalysis(ourPosts, compPosts) {
  const ourByTopic = {};
  for (const p of ourPosts) {
    for (const t of p.topics || []) {
      if (t === "ETC") continue;
      (ourByTopic[t] ??= []).push(p.eng ?? 0);
    }
  }
  const compByTopic = {};
  for (const p of compPosts) {
    for (const t of p.topics || []) {
      if (t === "ETC") continue;
      (compByTopic[t] ??= []).push(p);
    }
  }

  const common = [];
  const gap = [];
  for (const [t, list] of Object.entries(compByTopic)) {
    const compAvgEng = mean(list.map((p) => p.eng)) || 0;
    const top = list.slice().sort((a, b) => (b.eng || 0) - (a.eng || 0))[0];
    const sample = top ? { account: top.account, platform: top.platform, lang: top.lang, text: top.text, text_ko: top.text_ko, eng: top.eng, url: top.url } : null;
    if (ourByTopic[t]) {
      const ourAvgEng = mean(ourByTopic[t]) || 0;
      common.push({
        topic: t,
        ourCount: ourByTopic[t].length,
        ourAvgEng,
        compCount: list.length,
        compAvgEng,
        // 우리 평균이 경쟁 평균의 절반 미만이면 '약한 소재'
        weak: compAvgEng > 0 && ourAvgEng < compAvgEng * 0.5,
        topSample: sample,
      });
    } else {
      gap.push({ topic: t, compCount: list.length, compAvgEng, topSample: sample });
    }
  }
  common.sort((a, b) => b.compAvgEng - a.compAvgEng);
  gap.sort((a, b) => b.compAvgEng - a.compAvgEng);
  return { common, gap };
}

// 경쟁 바이럴 글의 훅 구조 추출 요약 — 참여 상위 글들의 훅 유형 빈도 + 대표 문장.
export function competitorHookSummary(compPosts, { topN = 10 } = {}) {
  const top = compPosts.slice().sort((a, b) => (b.eng || 0) - (a.eng || 0)).slice(0, topN);
  const byHook = {};
  for (const p of top) {
    const g = (byHook[p.hook_type] ??= { hook: p.hook_type, count: 0, samples: [] });
    g.count++;
    g.samples.push({ text: p.hook_text || (p.text || "").slice(0, 42), text_ko: p.text_ko, eng: p.eng, account: p.account, lang: p.lang });
  }
  return Object.values(byHook)
    .map((g) => ({ ...g, samples: g.samples.sort((a, b) => b.eng - a.eng).slice(0, 2) }))
    .sort((a, b) => b.count - a.count);
}

// "이거 분석해볼 만함" 추천(E) — 우리+경쟁 통틀어 [참여 상위 + 우리에게 없는 소재/훅] 글 콕 집기.
// ourPosts(enrich), compPosts(enrichCompetitorPosts). 갭 소재/우리가 안 쓴 훅에 가산점.
export function worthAnalyzing(ourPosts, compPosts, { max = 5 } = {}) {
  const ourTopics = new Set();
  const ourHooks = new Set();
  for (const p of ourPosts) {
    for (const t of p.topics || []) if (t !== "ETC") ourTopics.add(t);
    if (p.hook_type) ourHooks.add(p.hook_type);
  }
  // 경쟁 참여 정규화(계정별 편차 큼 → 전체 중앙값 대비 배수로)
  const med = median(compPosts.map((p) => p.eng)) || 1;
  const scored = compPosts.map((p) => {
    const topicGap = (p.topics || []).some((t) => t !== "ETC" && !ourTopics.has(t));
    const hookGap = p.hook_type && !ourHooks.has(p.hook_type);
    const engMultiple = (p.eng || 0) / med;
    // 점수 = 참여배수 × (소재갭 1.6 / 훅갭 1.3 가산)
    const score = engMultiple * (topicGap ? 1.6 : 1) * (hookGap ? 1.3 : 1);
    const reasons = [];
    const newTopic = (p.topics || []).find((t) => t !== "ETC" && !ourTopics.has(t));
    if (newTopic) reasons.push(`우리가 안 다룬 소재(${newTopic})`);
    if (hookGap) reasons.push(`우리가 안 쓴 훅(${p.hook_type})`);
    if (engMultiple >= 2) reasons.push(`경쟁 평균 ${engMultiple.toFixed(1)}배 참여`);
    return { post: p, score, topicGap, hookGap, engMultiple, reasons };
  });
  return scored
    .filter((s) => s.post.eng > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max);
}

// 같은 플랫폼(Threads) 직접 비교 그룹 vs 해외 영감(X) 그룹으로 분리(플랫폼 미스매치 정직하게).
export function splitCompetitorGroups(compPosts) {
  return {
    sameKr: compPosts.filter((p) => p.platform === "threads" && p.lang === "kr"),
    overseas: compPosts.filter((p) => p.platform === "x"),
  };
}

// ═════════════════════════════════════════════════════════════════════
// "오늘의 레퍼런스" — 키워드별 하루 1개 큐레이션 (전부 결정적, LLM 키 없음)
// ═════════════════════════════════════════════════════════════════════

// 키워드(주제) 사전 — 한/영/일 표현을 하나의 키워드로 묶음. 위에서부터 먼저 매칭.
// computeNER/topicFormatMatrix 가 아니라 별도 키워드 축으로 분류(영상·이미지·프롬프트 등 비전공자 친화 라벨).
export const KEYWORD_DICT = [
  ["AI영상",   /(영상|동영상|애니|애니메이션|릴스|쇼츠|비디오|video|animation|reels|short|vidu|sora|runway|kling|hailuo|veo|클링|런웨이|모션|movie|動画|アニメ|ムービー|モーション)/i],
  ["이미지생성", /(이미지|그림|일러스트|사진|포토|image|photo|illust|midjourney|미드저니|imagefx|imagen|nano\s?banana|dall|flux|stable\s?diffusion|화보|画像|イラスト|写真|生成画像)/i],
  ["프롬프트",  /(프롬프트|prompt|복붙|복사해서|呪文|プロンプト)/i],
  ["무료리소스", /(무료|공짜|free|폰트|아이콘|템플릿|소스|에셋|리소스|font|icon|template|asset|無料|フォント|アイコン|テンプレート|素材)/i],
  ["자동화",    /(자동화|워크플로우|workflow|n8n|에이전트|agent|cron|웹훅|webhook|스크립트|봇|자동|automation|自動化|ワークフロー|エージェント|自動)/i],
  ["AI뉴스",    /(출시|업데이트|공개|발표|release|launch|update|announce|dropped|신기능|새\s?기능|new\s?model|リリース|アップデート|発表|登場)/i],
  ["디자인",    /(디자인|레이아웃|배색|색상|폰트|타이포|design|layout|color|typography|색깔|배치|配色|レイアウト|デザイン|文字|タイポ)/i],
  ["AI툴",      /(도구|툴|tool|gpt|chatgpt|claude|클로드|gemini|제미나이|코덱스|codex|copilot|notebooklm|perplexity|grok|ツール|生成ai)/i],
];

// 키워드 우선순위(로테이션 목록) — 날짜 해시로 이 순서를 회전.
export const KEYWORDS = KEYWORD_DICT.map(([k]) => k);

// 비전공자용 키워드 한 줄 설명(렌더에서 사용).
export const KEYWORD_DESC = {
  "AI영상": "AI로 영상·애니메이션 만들기",
  "이미지생성": "AI로 이미지·그림·사진 만들기",
  "프롬프트": "복붙해서 쓰는 프롬프트 공개",
  "무료리소스": "무료 폰트·템플릿·소스 공유",
  "자동화": "반복 작업을 자동으로 돌리기",
  "AI뉴스": "새 모델·기능 출시 소식",
  "디자인": "보기 좋게 만드는 디자인 팁",
  "AI툴": "새로 나온 AI 도구 소개",
};

// 글 1개의 키워드 1개 부여(사전 순서대로 첫 매칭). 매칭 없으면 null.
export function keywordOf(post) {
  const text = `${post?.text || ""} ${post?.text_ko || ""}`;
  for (const [kw, re] of KEYWORD_DICT) if (re.test(text)) return kw;
  return null;
}

// YYYY-MM-DD → 결정적 정수 해시(날짜 문자열 char 합). 같은 날 = 같은 값.
function dateHash(dateStr) {
  const s = String(dateStr || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

// 날짜(YYYY-MM-DD) 기준으로 오늘의 키워드 1개를 결정적으로 선정(키워드 목록을 날짜 해시로 로테이션).
export function keywordForDate(dateStr, keywords = KEYWORDS) {
  if (!keywords.length) return null;
  return keywords[dateHash(dateStr) % keywords.length];
}

// 날짜 신뢰성: X 는 timestamp 가 정상이면 신뢰. Threads 는 발행일 부정확 → 신뢰 안 함.
// + "수집 시점(first_seen)보다 6개월+ 과거" 인 timestamp 는 잘못 파싱된 날짜로 보고 신뢰 안 함.
//   (계정 프로필의 책 출간일·핀 고정된 옛 베스트글 날짜가 글 날짜로 잘못 들어온 케이스 제거)
const SIX_MONTHS_MS = 182 * 86400e3;
export function reliableDate(post) {
  if (!post?.timestamp) return null;
  const ts = new Date(post.timestamp).getTime();
  if (Number.isNaN(ts)) return null;
  // 미래 날짜(수집보다 미래)면 의심 — 표시 안 함.
  const seen = post.first_seen ? new Date(post.first_seen).getTime() : Date.now();
  if (ts > seen + 86400e3) return null;
  // 수집보다 6개월+ 과거면 잘못 파싱된 날짜 의심 — 표시 안 함.
  if (seen - ts > SIX_MONTHS_MS) return null;
  // Threads 발행일은 크롤 특성상 부정확 → 날짜 숨김(렌더에서 "최근" 처리).
  if (post.platform === "threads") return null;
  return post.timestamp;
}

// 최근성: "오늘의 레퍼런스"는 최신 글만 후보로 (옛날 핀·바이럴 글 제외).
export const RECENT_DAYS = 30;
function effectiveDate(post) {
  const seen = post?.first_seen ? new Date(post.first_seen).getTime() : Date.now();
  // X(트위터) created_at 은 정확 → 옛날 글이면 옛날로 인정(최신필터에서 걸러짐). 핀 고정된 옛 바이럴 제외 목적.
  if (post?.platform === "x" && post?.timestamp) {
    const ts = new Date(post.timestamp).getTime();
    if (!Number.isNaN(ts) && ts <= seen + 86400e3) return ts;
  }
  return seen; // Threads 등 발행일 부정확 → 크롤 시점으로 대체
}
function isRecent(post, days = RECENT_DAYS) {
  return Date.now() - effectiveDate(post) <= days * 86400e3;
}

// 키워드는 "꼬리표"로만 (거름망 X). 매칭 없으면 "기타" → 좋은 글 안 버림.
const kwTag = (p) => keywordOf(p) || "기타";
const RECENT_HOT_DAYS = 7; // "최신+인기" 1차 윈도우

// 오늘의 레퍼런스: 최근 days일 글 "전부"(키워드 필터 X) 중 "최신+잘 나가는" 1등.
// = 최근 7일 내 참여 최고, 없으면 days일 내 참여 최고. 키워드는 태그로만 붙임.
// posts: enrichCompetitorPosts 결과(해외 X 글을 메인 후보로).
export function dailyReference(posts, dateStr, { overseasOnly = true, days = RECENT_DAYS } = {}) {
  const recent = (posts || []).filter((p) => (!overseasOnly || p.platform === "x") && isRecent(p, days));
  const byEng = (arr) => arr.slice().sort((a, b) => (b.eng || 0) - (a.eng || 0));
  const within = (d) => recent.filter((p) => Date.now() - effectiveDate(p) <= d * 86400e3);
  const best = byEng(within(RECENT_HOT_DAYS))[0] || byEng(recent)[0] || null; // 7일 내 핫 → 없으면 30일 내 핫
  const kw = best ? kwTag(best) : "기타";
  // 다른 최신(헤로 제외, 최신순, 키워드 중복 제거 최대 4) — 하단 표시용.
  const others = recent.filter((p) => p !== best).sort((a, b) => effectiveDate(b) - effectiveDate(a));
  const alts = [];
  const seen = new Set(best ? [kw] : []);
  for (const p of others) {
    const k = kwTag(p);
    if (seen.has(k)) continue;
    seen.add(k);
    alts.push({ keyword: k, account: p.account, lang: p.lang });
    if (alts.length >= 4) break;
  }
  return {
    keyword: kw,
    desc: KEYWORD_DESC[kw] || (kw === "기타" ? "우리 키워드 밖의 주목할 글" : ""),
    post: best ? { ...best, dateToShow: reliableDate(best) } : null,
    count: recent.length,
    alts,
  };
}

// 어제/오늘/내일 키워드 묶음(정보 표시용). dateStr = 오늘(YYYY-MM-DD).
export function referenceNeighbors(dateStr, keywords = KEYWORDS) {
  const base = new Date(`${dateStr}T00:00:00Z`).getTime();
  const day = 86400e3;
  const fmt = (t) => new Date(t).toISOString().slice(0, 10);
  return {
    yesterday: keywordForDate(fmt(base - day), keywords),
    today: keywordForDate(dateStr, keywords),
    tomorrow: keywordForDate(fmt(base + day), keywords),
  };
}

// 적용 포인트(결정적): 우리 계정에 이 키워드 글이 몇 건인지 세서 갭/약함/강함 → 시도/벤치마크 문장 생성.
// ourPosts: enrich 된 우리 글(text 보유). 키워드는 keywordOf 로 동일 기준 분류.
// 반환: { keyword, ourCount, level('gap'|'weak'|'strong'), sentence }.
export function applyPoint(keyword, ourPosts) {
  if (keyword === "기타") {
    return { keyword, ourCount: 0, level: "gap", sentence: "우리 키워드 분류 밖의 글입니다 — 새로운 소재 후보로 참고하세요." };
  }
  const ours = (ourPosts || []).filter((p) => keywordOf(p) === keyword);
  const ourCount = ours.length;
  let level, sentence;
  if (ourCount === 0) {
    level = "gap";
    sentence = `우리는 '${keyword}' 글이 아직 0건입니다 (갭). 이 레퍼런스를 본떠 첫 시도를 해보세요.`;
  } else if (ourCount <= 2) {
    level = "weak";
    sentence = `우리는 '${keyword}' 글이 ${ourCount}건뿐입니다 (약함). 이 레퍼런스의 훅·구성을 벤치마크해 더 밀어보세요.`;
  } else {
    level = "strong";
    sentence = `우리는 '${keyword}' 글이 ${ourCount}건 있습니다 (강점). 이 레퍼런스와 비교해 차별점을 더 살려보세요.`;
  }
  return { keyword, ourCount, level, sentence };
}
