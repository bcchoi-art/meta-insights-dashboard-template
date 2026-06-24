#!/usr/bin/env bash
# setup.sh — 비개발자용 대화형 셋업: Node 확인 → 토큰 입력 → 검증 → 대시보드 생성
# 사용:  bash setup.sh
cd "$(dirname "$0")"

echo "════════════════════════════════════════"
echo "  SNS 인사이트 대시보드 — 셋업 마법사"
echo "════════════════════════════════════════"

# 1/5 Node 확인
echo ""
echo "▶ 1/5  Node.js 확인…"
if ! command -v node >/dev/null 2>&1; then
  echo "   ❌ Node.js가 없습니다."
  echo "      https://nodejs.org 에서 'LTS' 버전을 설치한 뒤 이 창을 닫고 다시 실행하세요."
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
echo "   ✅ Node $(node -v)"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "   ⚠️  22 이상을 권장합니다. 계속하려면 Enter, 중단하려면 Ctrl+C"
  read -r _
fi

# 2/5 계정/토큰
echo ""
echo "▶ 2/5  계정·토큰 설정…"
if [ -f accounts.json ]; then
  echo "   accounts.json 이 이미 있습니다 → 그대로 사용 (새로 만들려면 파일 삭제 후 재실행)"
else
  echo "   토큰 발급법을 모르면 먼저 SETUP.md 를 보세요."
  echo "   (지금 비워두고 Enter만 눌러도 됩니다 — 나중에 accounts.json 을 직접 편집)"
  read -r -p "   · 계정 ID(영문, 예 mybrand): " ACC_ID
  read -r -p "   · 표시이름(예 내 브랜드): " ACC_LABEL
  read -r -p "   · Threads 토큰(없으면 Enter): " TH_TOKEN
  read -r -p "   · Instagram 토큰(없으면 Enter): " IG_TOKEN
  read -r -p "   · Instagram businessId(EAA 토큰일 때만, 없으면 Enter): " IG_BIZ
  ACC_ID="${ACC_ID:-mybrand}"
  node -e "
    const fs=require('node:fs');
    const [,, id,label,th,ig,biz]=process.argv;
    const acc={id, label:label||id, handle:id,
      threads:{token:th||''}, instagram:{token:ig||'', businessId:biz||''}};
    fs.writeFileSync('accounts.json', JSON.stringify({accounts:[acc]}, null, 2));
  " "$ACC_ID" "$ACC_LABEL" "$TH_TOKEN" "$IG_TOKEN" "$IG_BIZ"
  echo "   ✅ accounts.json 생성됨 (여러 계정은 SETUP.md 참고해 직접 추가)"
fi

# 3/5 경쟁사(선택)
echo ""
echo "▶ 3/5  경쟁사 워치리스트(선택)…"
if [ -f competitors.json ]; then
  echo "   competitors.json 이미 있음 → 그대로 사용"
else
  read -r -p "   경쟁사를 설정할까요? 없어도 동작합니다 (y/N): " WANT
  case "$WANT" in
    y|Y) cp competitors.example.json competitors.json
         echo "   competitors.json 생성 — 편집기로 열어 예시 핸들을 본인 경쟁사로 바꾸세요" ;;
    *)   echo "   건너뜀" ;;
  esac
fi

# 4/5 검증
echo ""
echo "▶ 4/5  토큰 연결 검증…"
node check-env.mjs || echo "   (연결 실패해도 다음 단계는 진행합니다)"

# 5/5 생성
echo ""
echo "▶ 5/5  대시보드 생성…"
if node dashboard.mjs; then
  echo ""
  echo "✅ 완료!  방금 만들어진 dashboard.html 을 브라우저로 엽니다…"
  command -v open >/dev/null 2>&1 && open dashboard.html
  echo "   배포까지 하려면:  VERCEL_PROJECT=내프로젝트명 bash deploy.sh"
else
  echo "   ❌ 생성 실패 — accounts.json 의 토큰을 확인하고 다시 실행하세요."
fi
