# 셋업 가이드 — Meta 토큰 발급 및 초기 설정

> **토큰 발급은 이 도구에서 제일 어려운 단계입니다.**
> Meta가 시키는 절차라 우리가 줄일 수 없어요.
> 천천히 따라오세요. 본인 Instagram · Facebook · Meta 개발자 계정이 필요합니다.

---

## §0. 사전 준비 (체크리스트)

아래 세 가지가 준비되어 있어야 합니다. 하나라도 없으면 토큰 발급이 안 됩니다.

- [ ] Instagram 계정이 **비즈니스 또는 크리에이터** 계정 (개인계정이면 안 됨)
- [ ] 그 Instagram이 **Facebook 페이지**에 연결됨
- [ ] Facebook 계정으로 [developers.facebook.com](https://developers.facebook.com) 로그인 가능

**하는 법:**

| 항목 | 전환 방법 |
|------|-----------|
| IG 계정을 비즈니스/크리에이터로 전환 | Instagram 앱 → 설정 → 계정 종류 및 도구 → 프로페셔널 계정으로 전환 |
| IG를 Facebook 페이지에 연결 | Instagram 앱 → 설정 → 비즈니스 → Facebook 페이지 연결 |

---

## §1. Meta 앱 만들기

### 클릭 경로

```
developers.facebook.com
  → [내 앱]                    ← 우상단 버튼
    → [앱 만들기]
      → 사용 사례: "기타" 선택
        → 앱 유형: "비즈니스" 선택
          → 앱 이름 입력 (예: my-sns-dashboard)
            → [앱 만들기] 완료
```

### 결과

앱 대시보드 화면이 열립니다.
좌측 사이드바에 **"제품 추가"** 메뉴가 보이면 성공입니다.

> **앱 ID · 앱 시크릿 위치:** 앱 대시보드 → 좌측 **설정 → 기본 설정** → 앱 ID / 앱 시크릿 코드

---

## §2. Instagram 토큰 발급

### 두 가지 방식 — 이 도구는 둘 다 지원합니다

| 방식 | 토큰 시작 | 사용 엔드포인트 | businessId 필요 여부 |
|------|-----------|----------------|----------------------|
| (A) Instagram API with Instagram Login | `IG` | `graph.instagram.com/me` | **불필요** |
| (B) Facebook 로그인 기반 (페이지 토큰) | `EAA` | `graph.facebook.com/{businessId}` | **필요** |

처음이라면 **(B) Graph API 탐색기로 빠르게** 받는 방법을 권장합니다.

---

### (B) Graph API 탐색기로 EAA 토큰 받기

#### 단계 1 — 탐색기 열기

```
앱 대시보드 상단 메뉴
  → [도구]
    → [Graph API Explorer]
```

#### 단계 2 — 앱 선택 & 토큰 생성

```
Graph API Explorer 화면
  → 우측 "Meta 앱" 드롭다운 → 방금 만든 앱 선택
  → "사용자 또는 페이지" 드롭다운 → "사용자 토큰" 선택
  → [권한 추가 (Add permissions)] 클릭
      ☑ instagram_basic
      ☑ instagram_manage_insights
      ☑ pages_read_engagement
      ☑ pages_show_list
  → [Generate Access Token] 클릭
  → Facebook 권한 승인 팝업 → 모두 허용
  → 토큰 문자열 복사  ← 이것이 "단기 토큰" (1~2시간 만료)
```

---

### (B) businessId 구하기

단기 토큰을 받은 상태에서 Graph API 탐색기 주소창에 아래 순서로 입력합니다.

```
STEP 1  주소창에 입력:  me/accounts
        → [전송]
        → 응답 JSON에서 내 Facebook 페이지의 "id" 값 복사
                                              ↓
STEP 2  주소창에 입력:  {페이지 id}?fields=instagram_business_account
        → [전송]
        → 응답에서 "instagram_business_account" → "id" 값 복사
                                              ↓
                              이 값이 businessId 입니다
```

**ASCII 흐름:**

```
me/accounts
  → 페이지 id (숫자)
    → {페이지 id}?fields=instagram_business_account
      → instagram_business_account.id  =  businessId (저장)
```

---

### (B) 단기 토큰 → 장기 토큰(60일) 교환

단기 토큰은 1~2시간이면 만료됩니다. 반드시 장기 토큰으로 교환하세요.

Graph API 탐색기 주소창에 아래를 입력 후 전송:

```
oauth/access_token
  ?grant_type=fb_exchange_token
  &client_id={앱 ID}
  &client_secret={앱 시크릿}
  &fb_exchange_token={단기 토큰}
```

> 앱 ID · 앱 시크릿: 앱 대시보드 → **설정 → 기본 설정**에서 확인

응답 JSON의 `access_token` 값이 **장기 토큰(60일)** 입니다. 이걸 accounts.json에 넣으세요.

---

## §3. Threads 토큰 발급

> **Instagram 토큰과 호환되지 않습니다 — 반드시 별도 발급해야 합니다.**

### 단계

```
앱 대시보드
  → 좌측 "제품 추가"
    → "Threads API" 찾아서 [설정] 클릭
      → Threads API 설정 화면에서 OAuth 인증 시작
        → 본인 Threads 계정으로 로그인 및 권한 승인
            ☑ threads_basic
            ☑ threads_manage_insights
        → 단기 토큰 발급됨
```

### 단기 → 장기 토큰 교환

아래 URL을 브라우저나 curl로 호출합니다:

```
GET https://graph.threads.net/access_token
  ?grant_type=th_exchange_token
  &client_id={앱 ID}
  &client_secret={앱 시크릿}
  &access_token={단기 토큰}
```

자세한 파라미터는 [Meta Threads API 공식 문서](https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions) 참고.

### 내 Threads user ID 확인

```
GET https://graph.threads.net/v1.0/me?fields=id,username&access_token={토큰}
```

응답의 `id` 값이 Threads user ID입니다 (accounts.json 작성 시 참고용).

---

## §4. accounts.json 에 넣기

```bash
cp accounts.example.json accounts.json
```

편집기로 `accounts.json`을 열어 아래처럼 채웁니다:

```json
{
  "accounts": [
    {
      "id": "mybrand",
      "label": "내 브랜드",
      "handle": "mybrand",
      "threads": {
        "token": "§3에서 받은 Threads 장기 토큰"
      },
      "instagram": {
        "token": "§2에서 받은 IG 또는 EAA 장기 토큰",
        "businessId": "EAA 토큰이면 §2의 businessId 필수 / IG 토큰이면 빈 문자열 가능"
      }
    }
  ]
}
```

**토큰 종류에 따른 businessId 규칙:**

| 토큰 시작 | businessId |
|-----------|------------|
| `IG...` | 빈 문자열(`""`) 가능 |
| `EAA...` | §2에서 구한 businessId **필수** |

여러 계정을 관리하려면 `accounts` 배열에 같은 구조의 객체를 추가합니다.

---

## §5. 연결 확인 & 대시보드 생성

```bash
# 토큰 연결 확인
node check-env.mjs
```

각 계정마다 아래처럼 나오면 성공입니다:

```
📡 mybrand  Threads 연결 ✅
📡 mybrand  Instagram 연결 ✅
```

```bash
# 대시보드 생성
node dashboard.mjs

# 브라우저로 열기
open dashboard.html
```

**제일 쉬운 길:** 위 과정을 한 번에 대화형으로 안내받으려면:

```bash
bash setup.sh
```

Node 확인 → 토큰 입력 → 검증 → 대시보드 생성까지 단계별로 안내합니다.

---

## §6. (선택) Vercel 배포

대시보드를 공개 URL로 공유하고 싶을 때 사용합니다.
배포되는 파일은 `dashboard.html`(토큰 없는 정적 HTML)만입니다.

```bash
# Vercel 계정 가입: vercel.com

# Vercel CLI 설치 (최초 1회)
npm i -g vercel

# 로그인 (브라우저 인증)
vercel login

# 배포
VERCEL_PROJECT=내프로젝트명 bash deploy.sh
```

배포 후 `https://내프로젝트명.vercel.app` 으로 접근 가능합니다.

---

## § 자주 막히는 점

| 증상 | 원인 | 해결 |
|------|------|------|
| 토큰 입력했는데 금방 연결 끊김 | 단기 토큰 사용 | §2/§3의 장기 토큰(60일) 교환 필수 |
| Instagram 연결이 안 됨 | 개인 계정이거나 Facebook 페이지 미연결 | §0 체크리스트 재확인 |
| EAA 토큰인데 데이터가 안 나옴 | businessId 누락 또는 오기입 | §2의 businessId 구하기 재진행 |
| Threads에 Instagram 토큰 넣었더니 오류 | 두 토큰은 별개 | §3에서 Threads 전용 토큰 별도 발급 |
| `instagram_business_account` 필드가 응답에 없음 | IG가 FB 페이지에 연결 안 됨 | Instagram 앱 → 설정 → 비즈니스 → Facebook 페이지 연결 |
