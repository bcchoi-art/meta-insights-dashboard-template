// data.mjs — Data 계층: accounts.json 로드 + Threads/Instagram API 호출(계정·채널 단위) + 로컬 캐시
//
// 멀티계정 구조:
//   accounts.json = { accounts: [{ id, label, threads:{token}, instagram:{token, businessId} }] }
//   각 fetch 함수는 토큰/설정을 직접 받는다(전역 env 의존 제거). dashboard.mjs 가 계정×채널로 호출.
//
// IG 라우트 자동판별(유지):
//   토큰이 "IG"로 시작 → graph.instagram.com/me (Instagram 로그인 API)
//   그 외(EAA… 페이지 토큰)  → graph.facebook.com/{businessId} (FB 페이지 기반)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ACCOUNTS_FILE = join(ROOT, "accounts.json");
const CACHE_FILE = join(ROOT, "posts-cache.json");
const SNAP_FILE = join(ROOT, "account-snapshots.json");

const THREADS_BASE = "https://graph.threads.net";
const THREADS_VERSION = "v1.0";
const GRAPH_VERSION = "v21.0";

// ───────────────────────── 계정 레지스트리 ─────────────────────────
export function loadAccounts() {
  if (!existsSync(ACCOUNTS_FILE)) return [];
  try {
    const raw = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
    return Array.isArray(raw.accounts) ? raw.accounts : [];
  } catch {
    return [];
  }
}

async function getJSON(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data;
}

// 글마다 박을 계정 태그(민감정보 없음 — id/label 만)
const acctTag = (account) => ({ id: account.id, label: account.label });

// ───────────────────────── Threads ─────────────────────────
const TH_FIELDS = "id,text,media_type,timestamp,permalink,media_url";
const TH_METRICS = "views,likes,replies,reposts,quotes,shares";

// account = { id, label, threads:{token} }
export async function fetchThreads(account, limit = 25) {
  const token = account.threads?.token;
  if (!token) return { ok: false, reason: "Threads 토큰 없음", posts: [] };
  const tag = acctTag(account);
  try {
    const list = await getJSON(`${THREADS_BASE}/${THREADS_VERSION}/me/threads?fields=${TH_FIELDS}&limit=${limit}&access_token=${token}`);
    const posts = [];
    for (const p of list.data || []) {
      let insights = null;
      try {
        const ins = await getJSON(`${THREADS_BASE}/${THREADS_VERSION}/${p.id}/insights?metric=${TH_METRICS}&access_token=${token}`);
        insights = {};
        for (const m of ins.data || []) insights[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
      } catch {
        insights = null;
      }
      posts.push({
        platform: "threads",
        account: tag,
        ...p,
        thumb: p.media_type !== "VIDEO" ? p.media_url || null : null,
        insights,
      });
    }
    return { ok: true, posts };
  } catch (e) {
    return { ok: false, reason: e.message, posts: [] };
  }
}

export async function fetchThreadsAccount(account) {
  const token = account.threads?.token;
  if (!token) return null;
  try {
    const ins = await getJSON(`${THREADS_BASE}/${THREADS_VERSION}/me/threads_insights?metric=followers_count&access_token=${token}`);
    const f = (ins.data || []).find((m) => m.name === "followers_count");
    return { threads_followers: f?.total_value?.value ?? f?.values?.[0]?.value ?? null };
  } catch {
    return null;
  }
}

// ───────────────────────── Instagram ─────────────────────────
const IG_FIELDS = "id,caption,media_type,permalink,timestamp,like_count,comments_count,media_url,thumbnail_url,children{media_url,thumbnail_url,media_type}";
const IG_METRICS = "reach,likes,comments,saved,shares,total_interactions";

// IG 라우트 자동판별: 토큰 prefix 로 graph.instagram.com vs graph.facebook.com 결정
function igRoute(token, businessId) {
  const igLogin = token.startsWith("IG");
  return {
    node: igLogin ? "me" : businessId,
    apiBase: igLogin ? "https://graph.instagram.com" : `https://graph.facebook.com/${GRAPH_VERSION}`,
    igLogin,
  };
}

// account = { id, label, instagram:{token, businessId} }
export async function fetchInstagram(account, limit = 25) {
  const token = account.instagram?.token;
  if (!token) return { ok: false, reason: "Instagram 토큰 없음", posts: [] };
  const businessId = account.instagram?.businessId;
  const { node, apiBase } = igRoute(token, businessId);
  if (!node) return { ok: false, reason: "businessId 없음 (FB 페이지 토큰일 때 필요)", posts: [] };
  const tag = acctTag(account);

  try {
    const list = await getJSON(`${apiBase}/${node}/media?fields=${IG_FIELDS}&limit=${limit}&access_token=${token}`);
    const posts = [];
    for (const p of list.data || []) {
      let insights = null;
      try {
        const metric = p.media_type === "VIDEO" ? `${IG_METRICS},views` : IG_METRICS;
        const ins = await getJSON(`${apiBase}/${p.id}/insights?metric=${metric}&access_token=${token}`);
        insights = {};
        for (const m of ins.data || []) insights[m.name] = m.values?.[0]?.value ?? m.total_value?.value ?? 0;
      } catch {
        insights = null;
      }
      const ch = p.children?.data?.[0];
      posts.push({
        platform: "instagram",
        account: tag,
        id: p.id,
        text: p.caption || "",
        media_type: p.media_type,
        timestamp: p.timestamp,
        permalink: p.permalink,
        like_count: p.like_count,
        comments_count: p.comments_count,
        thumb: p.thumbnail_url || p.media_url || ch?.thumbnail_url || ch?.media_url || null,
        insights,
      });
    }
    return { ok: true, posts };
  } catch (e) {
    return { ok: false, reason: e.message, posts: [] };
  }
}

export async function fetchInstagramAccount(account) {
  const token = account.instagram?.token;
  if (!token) return null;
  const businessId = account.instagram?.businessId;
  const { node, apiBase, igLogin } = igRoute(token, businessId);
  if (!node) return null;
  try {
    // graph.instagram.com/me 와 graph.facebook.com/{businessId} 둘 다 followers_count 지원
    const fields = igLogin ? "followers_count,media_count" : "followers_count";
    const me = await getJSON(`${apiBase}/${node}?fields=${fields}&access_token=${token}`);
    return { ig_followers: me.followers_count ?? null };
  } catch {
    return null;
  }
}

// ───────────────────────── 로컬 캐시(누적 저장, 계정 차원 포함) ─────────────────────────
// 키: `${accountId}:${postId}` — 같은 글 id 가 계정 간 충돌하지 않도록 계정으로 네임스페이스.
// 레거시(account 없는) 캐시 글은 fresh fetch 가 새 키로 덮어쓰며, 안 겹치면 bbopters 로 간주해 보존.
const LEGACY_ACCOUNT = { id: "bbopters", label: "뽀피터스" };

function cacheKey(p) {
  const acctId = p.account?.id || LEGACY_ACCOUNT.id;
  return `${acctId}:${p.id}`;
}

export function mergePostsCache(freshPosts) {
  let cache = { posts: {} };
  if (existsSync(CACHE_FILE)) {
    try { cache = JSON.parse(readFileSync(CACHE_FILE, "utf8")); } catch { /* corrupt → reset */ }
  }
  cache.posts ??= {};

  // 레거시 글(account 필드 없음 + 키가 `id` 형태)을 bbopters 네임스페이스로 1회 마이그레이션
  const migrated = {};
  for (const [k, v] of Object.entries(cache.posts)) {
    if (k.includes(":")) { migrated[k] = v; continue; }
    const acct = v.account || LEGACY_ACCOUNT;
    migrated[`${acct.id}:${v.id}`] = { ...v, account: v.account || LEGACY_ACCOUNT };
  }
  cache.posts = migrated;

  const now = new Date().toISOString();
  for (const p of freshPosts) {
    const key = cacheKey(p);
    const prev = cache.posts[key];
    cache.posts[key] = { ...prev, ...p, first_seen: prev?.first_seen ?? now, last_updated: now };
  }
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
  return Object.values(cache.posts);
}

// 팔로워 시점 스냅샷 — 계정 차원 포함. snaps 항목: { at, date, account:{id,label}, threads_followers, ig_followers }
export function snapshotAccount(account, metrics) {
  if (!metrics) return loadSnapshots();
  let snaps = loadSnapshots();
  const now = new Date();
  const at = now.toISOString();
  // 같은 계정의 마지막 스냅샷 찾기
  const sameAcct = snaps.filter((s) => (s.account?.id || LEGACY_ACCOUNT.id) === account.id);
  const last = sameAcct[sameAcct.length - 1];
  if (last && now - new Date(last.at || `${last.date}T00:00:00Z`) < 30 * 60 * 1000) {
    // 30분 이내 재실행 → 마지막 점 갱신(수동 재실행 스팸 방지)
    Object.assign(last, { at, date: at.slice(0, 10), account: acctTag(account), ...metrics });
  } else {
    snaps.push({ at, date: at.slice(0, 10), account: acctTag(account), ...metrics });
  }
  writeFileSync(SNAP_FILE, JSON.stringify(snaps, null, 2), "utf8");
  return snaps;
}

export function loadSnapshots() {
  if (!existsSync(SNAP_FILE)) return [];
  try { return JSON.parse(readFileSync(SNAP_FILE, "utf8")); } catch { return []; }
}
