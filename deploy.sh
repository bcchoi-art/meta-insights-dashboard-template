#!/bin/bash
# 최신 데이터로 대시보드 재생성 → 토큰 없는 폴더에 복사 → Vercel 프로덕션 재배포
# 사용: ./deploy.sh
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# 스테이징은 /tmp 대신 프로젝트 안 .deploy 로 (재부팅 때 /tmp 가 날아가 .vercel 링크가 소실되던 문제 방지)
DEPLOY_DIR="$ROOT/.deploy"
PROJECT="${VERCEL_PROJECT:-meta-insights-dashboard}"   # VERCEL_PROJECT env 로 덮어쓰기 가능
TOKEN_ARG=""; [ -n "$VERCEL_TOKEN" ] && TOKEN_ARG="--token $VERCEL_TOKEN"

echo "1) 최신 데이터로 대시보드 생성…"
node dashboard.mjs

echo "2) 토큰 없는 배포 폴더 준비 (index.html만 갱신, .vercel 링크는 보존)…"
mkdir -p "$DEPLOY_DIR"
cp dashboard.html "$DEPLOY_DIR/index.html"

echo "3) Vercel 프로젝트 링크 확인 (없으면 자동 재링크)…"
if [ ! -f "$DEPLOY_DIR/.vercel/project.json" ]; then
  vercel link --yes --project "$PROJECT" --cwd "$DEPLOY_DIR" $TOKEN_ARG
fi

echo "4) Vercel 프로덕션 배포…"
vercel deploy --prod --yes --cwd "$DEPLOY_DIR" $TOKEN_ARG
