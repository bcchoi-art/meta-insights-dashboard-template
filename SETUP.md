# 셋업 가이드 — Meta 토큰 발급 및 초기 설정

## 1. Meta 앱 생성

1. [developers.facebook.com](https://developers.facebook.com) 접속 → **내 앱** → **앱 만들기**
2. 앱 유형: "비즈니스" 또는 "기타" 선택
3. 생성 후 **설정 → 기본 설정**에서 확인:
   - `앱 ID` (META_APP_ID)
   - `앱 시크릿 코드` (META_APP_SECRET)
4. Graph API 권장 버전: `v21.0`

---

## 2. Instagram 토큰 발급

### 전제 조건
- Instagram 계정이 **비즈니스** 또는 **크리에이터** 계정이어야 합니다
- 해당 IG 계정이 **Facebook 페이지에 연결**되어 있어야 합니다

### 필요한 권한(scope)
```
instagram_basic
instagram_manage_insights
pages_read_engagement
pages_show_list
```

### 토큰 타입 — 둘 중 하나 선택

| 타입 | 토큰 시작 | 사용 엔드포인트 | businessId 필요 여부 |
|------|-----------|----------------|----------------------|
| IG 로그인 토큰 | `IG` | `graph.instagram.com/me` | 불필요 |
| FB 페이지 토큰 | `EAA` | `graph.facebook.com/{businessId}` | **필요** |

### 단기 토큰 → long-lived(60일) 교환
```
GET https://graph.facebook.com/v21.0/oauth/access_token
  ?grant_type=fb_exchange_token
  &client_id={APP_ID}
  &client_secret={APP_SECRET}
  &fb_exchange_token={단기토큰}
```

### businessId 구하기 (EAA 페이지 토큰일 때만)
```bash
# 1) 내 페이지 목록 조회
GET https://graph.facebook.com/v21.0/me/accounts?access_token={토큰}

# 2) 페이지 ID로 IG 비즈니스 계정 ID 조회
GET https://graph.facebook.com/v21.0/{page-id}?fields=instagram_business_account&access_token={토큰}
```
응답의 `instagram_business_account.id` 값이 `businessId`입니다.

---

## 3. Threads 토큰 발급

> Threads 토큰은 Instagram 토큰과 **별개**입니다. 공유할 수 없습니다.

### 단계
1. Meta 앱에서 **사용 사례 추가 → "Threads API"** 선택
2. Threads 계정으로 OAuth 인증 (Instagram OAuth와 별도 흐름)
3. 필요한 권한(scope):
   ```
   threads_basic
   threads_manage_insights
   ```
4. 단기 토큰 → long-lived 교환:
   ```
   GET https://graph.threads.net/access_token
     ?grant_type=th_exchange_token
     &client_id={APP_ID}
     &client_secret={APP_SECRET}
     &access_token={단기토큰}
   ```
5. Threads user ID 확인:
   ```
   GET https://graph.threads.net/v1.0/me?fields=id,username&access_token={토큰}
   ```

---

## 4. accounts.json 채우기

`accounts.example.json`을 복사한 뒤 위에서 발급한 토큰을 입력합니다:

```bash
cp accounts.example.json accounts.json
```

```json
{
  "accounts": [
    {
      "id": "mybrand",
      "label": "My Brand",
      "handle": "mybrand",
      "threads": {
        "token": "여기에 Threads long-lived 토큰"
      },
      "instagram": {
        "token": "여기에 IG 또는 EAA 토큰",
        "businessId": "EAA 토큰일 때만 필요 — IG 토큰이면 빈 문자열 가능"
      }
    }
  ]
}
```

여러 계정을 관리하려면 배열에 계정 객체를 추가하면 됩니다.

---

## 5. 연결 확인

```bash
node check-env.mjs
```

- `✅` — 토큰이 있고 API 연결 성공
- `⬜` — 토큰이 비어있음
- `❌` — 연결 실패 (토큰 만료 또는 권한 부족)

---

## 6. Vercel 배포 (선택)

대시보드를 공개 URL로 공유하고 싶을 때 사용합니다. 배포되는 파일은 `dashboard.html`(토큰 없는 정적 HTML)만입니다.

```bash
# Vercel CLI 설치 (최초 1회)
npm i -g vercel

# 로그인 (브라우저 인증)
vercel login

# 배포
VERCEL_PROJECT=내프로젝트명 bash deploy.sh

# 또는 토큰으로 CI 환경에서 배포
VERCEL_PROJECT=내프로젝트명 VERCEL_TOKEN=xxxx bash deploy.sh
```

배포 후 `https://내프로젝트명.vercel.app` 으로 접근 가능합니다.
