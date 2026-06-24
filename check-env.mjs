// check-env.mjs — accounts.json 검증 + Threads/Instagram API 연결 스모크 테스트
// 실행:  node check-env.mjs   (Node 22+, 내장 fetch / 의존성 0)

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const ACCOUNTS_FILE = join(ROOT, "accounts.json");
const THREADS_BASE = "https://graph.threads.net";
const THREADS_VERSION = "v1.0";
const GRAPH_VERSION = "v21.0";

const mask = (v) => !v ? "(비어있음)" : v.length <= 8 ? v[0] + "***" : v.slice(0, 6) + "…" + v.slice(-4);

function loadAccounts() {
  if (!existsSync(ACCOUNTS_FILE)) return null;
  try {
    const raw = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
    return Array.isArray(raw.accounts) ? raw.accounts : [];
  } catch { return undefined; }
}

async function ping(label, url) {
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (res.ok && !data.error) return { label, ok: true, data };
    return { label, ok: false, status: res.status, error: data.error || data };
  } catch (e) { return { label, ok: false, error: { message: e.message } }; }
}

function igRoute(token, businessId) {
  const igLogin = token.startsWith("IG");
  return { node: igLogin ? "me" : businessId, apiBase: igLogin ? "https://graph.instagram.com" : `https://graph.facebook.com/${GRAPH_VERSION}` };
}

async function main() {
  console.log("\n🔍 accounts.json 검증:", ACCOUNTS_FILE, "\n");
  const accounts = loadAccounts();
  if (accounts === null) { console.log("❌ accounts.json 이 없습니다. `cp accounts.example.json accounts.json` 후 토큰을 채우세요.\n"); process.exit(1); }
  if (accounts === undefined) { console.log("❌ accounts.json 파싱 실패 — JSON 형식을 확인하세요.\n"); process.exit(1); }
  if (!accounts.length) { console.log("❌ accounts.json 에 계정이 없습니다.\n"); process.exit(1); }

  for (const acct of accounts) {
    console.log(`▸ [${acct.id}] ${acct.label || ""}`);
    const thToken = acct.threads?.token;
    const igToken = acct.instagram?.token;
    const igBiz = acct.instagram?.businessId;
    console.log(`   Threads token   ${thToken ? "✅ " + mask(thToken) : "⬜ (없음)"}`);
    console.log(`   Instagram token ${igToken ? "✅ " + mask(igToken) : "⬜ (없음)"}`);
    const tests = [];
    if (thToken) tests.push(ping("Threads", `${THREADS_BASE}/${THREADS_VERSION}/me?fields=id,username&access_token=${thToken}`));
    if (igToken) {
      const { node, apiBase } = igRoute(igToken, igBiz);
      if (node) tests.push(ping("Instagram", `${apiBase}/${node}?fields=username,followers_count&access_token=${igToken}`));
      else console.log("   ⏭  Instagram: FB 페이지 토큰인데 businessId 가 없어 테스트 건너뜀");
    }
    for (const r of await Promise.all(tests)) {
      if (r.ok) console.log(`   📡 ${r.label} 연결 ✅`, JSON.stringify(r.data));
      else console.log(`   📡 ${r.label} 연결 ❌`, JSON.stringify(r.error));
    }
    console.log("");
  }
}
main();
