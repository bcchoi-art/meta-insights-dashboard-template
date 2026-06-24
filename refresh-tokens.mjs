// refresh-tokens.mjs — 만료 임박한 장기 토큰을 자동 연장하고 accounts.json 을 갱신.
// 실행:  node refresh-tokens.mjs      (월 1회 권장 / cron 가능)
//
// 자동 갱신 가능: Threads 토큰 + Instagram "IG..."(IG 로그인) 토큰 → 각각 +60일 연장.
// 자동 갱신 불가: Facebook 페이지 토큰("EAA...") → SETUP.md 보고 수동 재발급해야 함.
// 주의: 토큰이 이미 만료됐거나 발급 24시간 이내면 갱신이 거부될 수 있음.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FILE = join(ROOT, "accounts.json");

async function getJSON(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error?.message || `HTTP ${res.status}`);
  return data;
}
const days = (s) => Math.round((s || 0) / 86400);

async function refreshThreads(token) {
  const d = await getJSON(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${token}`);
  return { token: d.access_token, expires_in: d.expires_in };
}
async function refreshIGLogin(token) {
  const d = await getJSON(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`);
  return { token: d.access_token, expires_in: d.expires_in };
}

async function main() {
  if (!existsSync(FILE)) { console.error("❌ accounts.json 이 없습니다. 먼저 셋업하세요(SETUP.md)."); process.exit(1); }
  const cfg = JSON.parse(readFileSync(FILE, "utf8"));
  let changed = false;
  for (const acc of cfg.accounts || []) {
    console.log(`\n▸ [${acc.id}] ${acc.label || ""}`);
    const th = acc.threads?.token;
    if (th) {
      try { const r = await refreshThreads(th); acc.threads.token = r.token; changed = true;
            console.log(`   Threads ✅ 갱신됨 (앞으로 ~${days(r.expires_in)}일)`); }
      catch (e) { console.log(`   Threads ⚠️ 갱신 실패: ${e.message}`); }
    }
    const ig = acc.instagram?.token;
    if (ig && ig.startsWith("IG")) {
      try { const r = await refreshIGLogin(ig); acc.instagram.token = r.token; changed = true;
            console.log(`   Instagram ✅ 갱신됨 (앞으로 ~${days(r.expires_in)}일)`); }
      catch (e) { console.log(`   Instagram ⚠️ 갱신 실패: ${e.message}`); }
    } else if (ig && ig.startsWith("EAA")) {
      console.log("   Instagram ⏭ FB 페이지 토큰(EAA)은 자동 갱신 불가 — SETUP.md 보고 수동 재발급하세요");
    }
  }
  if (changed) { writeFileSync(FILE, JSON.stringify(cfg, null, 2), "utf8"); console.log("\n✅ accounts.json 갱신 저장 완료."); }
  else console.log("\n변경 없음.");
}
main().catch((e) => { console.error("❌ 실패:", e.message); process.exit(1); });
