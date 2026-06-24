# 운영 매뉴얼 (RUNBOOK)

이 문서는 이 대시보드를 넘겨받은 담당자가 보는 운영 설명서입니다. 코딩 몰라도 따라올 수 있게 썼어요. 토큰 값은 전임자/대표님께 받으세요(직접 발급법은 SETUP.md).

---

## 1. 처음 한 번만 — 셋업

1. **Node 설치**: [nodejs.org](https://nodejs.org) 에서 'LTS' 버전을 내려받아 설치.
2. **폴더 받기**: 이 레포를 클론하거나 ZIP 다운로드.
3. **토큰 넣기**: 터미널에서 아래 명령 실행 → 전임자한테 받은 토큰을 붙여넣기.
   ```bash
   bash setup.sh
   ```
   또는 전임자에게 받은 `accounts.json` 파일을 폴더에 그대로 넣어도 됩니다.
4. ⚠️ `accounts.json`(토큰)은 **절대 외부 공유·커밋 금지**. 이미 `.gitignore`에 있음.

---

## 2. 평소 운영 — 대시보드 새로고침

```bash
node dashboard.mjs
```

끝나면 아래 명령으로 브라우저에서 확인:

```bash
open dashboard.html
```

- **권장 주기**: 하루 1~2회(수동) 또는 cron 자동(README "자동 스케줄링" 참고).
- **(선택) 웹에 올려 공유하려면**:
  ```bash
  VERCEL_PROJECT=이름 bash deploy.sh
  ```

---

## 3. ★제일 중요 — 토큰이 만료됐을 때★

Meta 토큰은 약 **60일마다 만료**됩니다. 증상: `node check-env.mjs` 에서 `❌` / 대시보드에 새 데이터가 안 들어옴.

### 해결 순서

1. **먼저 자동 갱신 시도** — Threads·IG 로그인 토큰은 이걸로 +60일 연장:
   ```bash
   node refresh-tokens.mjs
   ```

2. 그래도 실패하거나 토큰이 `EAA`로 시작(FB 페이지 토큰)하면 → `SETUP.md` 보고 **수동 재발급** 후 `accounts.json` 교체.

> 💡 팁: 만료 전에 미리 갱신하면 안 끊깁니다. **50일마다 `refresh-tokens.mjs`를 돌리도록 캘린더 알림이나 cron 설정**하세요(예: 매월 1일).

---

## 4. 자주 나는 문제

| 증상 | 원인 | 해결 |
|------|------|------|
| check-env ❌ / 데이터 안 들어옴 | 토큰 만료 | §3 (refresh-tokens.mjs → 안 되면 수동 재발급) |
| Instagram만 ❌ | businessId 누락/오입력 | SETUP.md §2 |
| 경쟁사 크롤 0개 | rate-limit/IP 차단 | 잠시 후 재실행, competitors.json 핸들 확인 |
| dashboard.html 안 열림 | 생성 실패 | check-env 로 토큰부터 확인 |
| AI 레이더 탭 비어있음 | 정상(외부 데이터 미연동) | 무시 가능 |

---

## 5. 막히면

- **SETUP.md** — 토큰 발급 상세 안내
- **전임자 연락** — accounts.json 원본 요청
- **Claude Code 있으면** — 이 폴더 열고 "이거 안 돼"라고 물어보면 `CLAUDE.md` 보고 도와줌
