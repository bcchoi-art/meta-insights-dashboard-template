# CLAUDE.md — SNS 인사이트 대시보드 템플릿 플레이북

이 레포는 SNS 인사이트 대시보드 **템플릿**이다. 사용자가 "돌리고 싶다/셋업"이라고 하면 아래 순서로 안내·실행하라.

---

## 셋업 순서

1. **Node 버전 확인**
   ```bash
   node -v   # 22.x 이상이어야 함
   ```

2. **accounts.json 설정**
   - `accounts.json`이 없으면:
     ```bash
     cp accounts.example.json accounts.json
     ```
   - 사용자에게 토큰 입력을 요청한다. 토큰 발급법은 `SETUP.md`를 안내하라.
   - **중요**: 토큰을 대신 만들어줄 수 없다. 사용자 본인의 Meta 앱과 계정이 필요하다. developers.facebook.com에서 직접 발급해야 한다.

3. **토큰 연결 검증**
   ```bash
   node check-env.mjs
   ```
   - `✅` 표시가 나와야 다음 단계로 진행.
   - 실패(`❌`)하면 토큰 만료·권한 부족 여부를 SETUP.md와 함께 안내.

4. **대시보드 생성**
   ```bash
   node dashboard.mjs
   ```
   → `dashboard.html` 생성됨.

5. **브라우저로 열기**
   ```bash
   open dashboard.html
   ```

6. **(선택) 경쟁사 워치리스트 설정**
   ```bash
   cp competitors.example.json competitors.json
   # competitors.json 열어서 핸들 입력
   ```
   설정 없이도 동작함(빈 워치리스트). 설정하면 "오늘의 레퍼런스" 탭이 채워짐.

7. **(선택) Vercel 배포 + cron 자동화**
   ```bash
   VERCEL_PROJECT=내프로젝트명 bash deploy.sh
   ```
   자동 갱신은 cron/launchd로 `node dashboard.mjs`를 주기 실행(2시간 권장).

---

## 아키텍처 (3계층)

| 파일 | 계층 | 역할 |
|------|------|------|
| `src/data.mjs` | Data | accounts.json 로드 + Threads/IG API 호출 + 캐시 |
| `src/competitors.mjs` | Data | 토큰 없는 경쟁사 크롤 + 무료 번역 캐시 |
| `src/logic.mjs` | Logic | 지표 계산·점수·레퍼런스·갭 분석 (순수 함수) |
| `src/render.mjs` | Presentation | 단일 HTML 렌더링 |
| `dashboard.mjs` | 엔트리 | 위 계층 조립·실행 |

---

## 가드레일

- `accounts.json`, `competitors.json`, 토큰 값은 **절대 커밋·외부 전송 금지**.
  `.gitignore`에 이미 포함되어 있다. 커밋 전 반드시 확인.
- 토큰은 **사용자 본인 것만** 사용. 타인의 토큰을 코드에 하드코딩하지 말 것.
- 경쟁사 크롤은 데이터센터 IP(GitHub Actions 등)에서 차단될 수 있음. 로컬/상시 머신 실행 권장.

---

## 자주 막히는 점

| 증상 | 원인 | 해결 |
|------|------|------|
| Instagram 연결 ❌ (businessId 오류) | EAA 토큰인데 businessId가 없음 | SETUP.md §2 "businessId 구하기" 참고 |
| Instagram 연결 ❌ (IG 토큰에 businessId 입력) | IG 토큰은 businessId 불필요 | businessId를 빈 문자열로 두거나 제거 |
| Threads 연결 ❌ | IG 토큰을 Threads에 사용 | Threads 토큰은 별도 발급 필요 (SETUP.md §3) |
| 경쟁사 크롤 0개 | rate-limit 또는 데이터센터 IP 차단 | 로컬 머신에서 재실행; competitors.json 핸들 확인 |
| AI 레이더 탭 비어있음 | data/analyzed.json 없음 | 정상 동작. 해당 탭은 외부 레이더 데이터 연동 시에만 활성화 |
