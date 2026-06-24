# SNS 인사이트 대시보드 템플릿

Threads + Instagram 계정 성과 + 경쟁사 레퍼런스를 자동 집계해 **단일 HTML 대시보드**로 만드는 의존성 0 도구.

## 특징

| 항목 | 설명 |
|------|------|
| 의존성 0 | Node 22 내장 fetch만 사용. npm install 불필요 |
| 계정×채널 지표 | Threads·Instagram별 팔로워·참여·돌파글·점수 |
| 오늘의 레퍼런스 | 경쟁사 핫글 큐레이션(토큰 불필요, 무료 크롤) |
| 토픽 갭 분석 | 내 콘텐츠 vs 경쟁사 다루는 주제 차이 자동 분석 |
| 팔로워 추이 | 시간별 팔로워 변화 추적 |
| AI 콘텐츠 레이더 | (선택) 외부 analyzed.json 연동 시 AI 레이더 탭 활성화 |
| Vercel 배포 | 한 줄 명령으로 퍼블릭 URL 생성 |

## 요구사항

- Node 22+
- Meta 앱(Instagram 및/또는 Threads 액세스 토큰)
- (선택) Vercel 계정 — 배포 시에만 필요

## 5분 퀵스타트

```bash
# 1. 클론
git clone <repo> && cd meta-insights-dashboard-template

# 2. 계정 설정 (토큰 발급법은 SETUP.md 참고)
cp accounts.example.json accounts.json
# accounts.json 열어서 토큰 입력

# 3. (선택) 경쟁사 워치리스트 설정
cp competitors.example.json competitors.json
# competitors.json 열어서 핸들 입력

# 4. 토큰 연결 확인
node check-env.mjs

# 5. 대시보드 생성
node dashboard.mjs

# 6. 브라우저로 열기
open dashboard.html

# 7. (선택) Vercel 배포
VERCEL_PROJECT=내프로젝트명 bash deploy.sh
```

## 자동 스케줄링

상시 구동 머신(맥미니, NAS 등)의 cron/launchd 설정을 권장합니다.

```bash
# crontab -e 에 추가 — 2시간마다 자동 갱신
0 */2 * * * cd /절대경로/meta-insights-dashboard-template && /usr/local/bin/node dashboard.mjs >> cron.log 2>&1
```

> **주의**: GitHub Actions 등 데이터센터 IP에서는 X(트위터) 크롤이 rate-limit/차단되기 쉽습니다.
> 집/사무실 IP의 상시 머신이 크롤 품질에 유리합니다.

## 아키텍처 (3계층)

| 파일 | 계층 | 역할 |
|------|------|------|
| `src/data.mjs` | Data | accounts.json 로드 + Threads/IG API 호출 + 캐시 |
| `src/competitors.mjs` | Data | 토큰 없는 경쟁사 크롤 + 무료 번역 캐시 |
| `src/logic.mjs` | Logic | 지표 계산·점수·레퍼런스·갭 분석 (순수 함수) |
| `src/render.mjs` | Presentation | 단일 HTML 렌더링 |
| `dashboard.mjs` | 엔트리 | 위 4계층 조립·실행 |

## 설정 파일

| 파일 | 용도 | git |
|------|------|-----|
| `accounts.json` | 내 Threads/IG 토큰 | **gitignore — 절대 커밋 금지** |
| `competitors.json` | 경쟁사 워치리스트 핸들 | gitignore |
| `data/analyzed.json` 또는 `RADAR_DATA` env | (선택) AI 콘텐츠 레이더 데이터 | gitignore |

> `accounts.json`과 `competitors.json`은 `.gitignore`에 이미 포함되어 있습니다. 절대 커밋하지 마세요.
