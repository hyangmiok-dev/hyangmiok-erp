# 향미옥 경영관리 시스템

향미옥 1·2·3호점의 매출·손익·인건비·재고·육수 생산을 한곳에서 관리하는 웹사이트입니다.
PC에서는 대표용 분석 화면, 휴대폰에서는 직원용 현장 입력 화면으로 동작합니다.

> **현재 진행 상황: 1단계 (로그인 · 권한 · 계정 관리)** — 자세한 내용은 [docs/STATUS.md](docs/STATUS.md)
> 매출 입력과 대시보드 숫자는 2단계에서 추가됩니다.

---

## 처음 설치하기 (약 30분, 한 번만)

### 준비물
- 이 폴더가 있는 PC (Windows)
- 이메일 계정 1개 (Supabase·Vercel 가입용)

### 1단계. 프로그램 설치 (이미 설치됨)
Node.js(24 LTS)와 Git이 이 PC에 설치되어 있습니다. 다른 PC에서는 아래 두 프로그램을 먼저 설치하세요.
- Node.js LTS: https://nodejs.org
- Git: https://git-scm.com

### 2단계. 데이터베이스(Supabase) 만들기
1. https://supabase.com 에 가입하고 **New project** 를 누릅니다.
   - 이름: `hyangmiok-dev` (개발·연습용). 실제 운영용은 나중에 `hyangmiok-prod` 로 **따로** 만듭니다.
   - Region: **Northeast Asia (Seoul)**
   - Database password: 길고 복잡하게 만들고 안전한 곳에 보관
2. 프로젝트가 만들어지면 왼쪽 메뉴 **SQL Editor** → **New query** 를 엽니다.
3. 이 폴더의 `supabase/migrations` 안의 **.sql 파일을 이름 순서대로 하나씩** 메모장으로 열어 **전체 복사 → 붙여넣기 → Run** (파일마다 한 번씩).
   - "Success" 가 나오면 됩니다. (한 번만 실행하세요)
4. 보안 설정 (꼭 하세요)
   - **Authentication → Sign In / Providers → Email**: `Allow new users to sign up` **끄기** (아무나 가입하지 못하게)
   - 같은 화면의 비밀번호 최소 길이(Minimum password length): **6** (직원 비밀번호가 숫자 6자리이기 때문. 관리자 비밀번호 10자 규칙은 프로그램이 따로 검사합니다)
5. 대표 계정 만들기
   - **Authentication → Users → Add user → Create new user**: 대표 이메일·비밀번호 입력, `Auto Confirm User` 체크
   - **SQL Editor** 에서 `supabase/bootstrap-owner.sql` 내용을 붙여넣고, `owner@example.com` 을 대표 이메일로 바꾼 뒤 **Run**
     → 마지막 결과에 대표 1줄이 `owner / true` 로 보이면 성공

### 3단계. 연결 정보 넣기
1. Supabase 왼쪽 메뉴 **Project Settings → API Keys** 에서 아래 값을 확인합니다.
   - Project URL
   - Publishable key (`sb_publishable_...`)
   - Secret key (`sb_secret_...`) — **절대 다른 사람에게 보내지 마세요**
2. 이 폴더의 `.env.example` 파일을 복사해서 이름을 `.env.local` 로 바꿉니다.
3. `.env.local` 을 메모장으로 열어 위 값들을 붙여넣고 저장합니다.

### 4단계. 실행
이 폴더에서 PowerShell(또는 터미널)을 열고:

```bash
npm install
```

```bash
npm run dev
```

브라우저에서 http://localhost:3000 을 열고 대표 이메일로 로그인합니다.
화면 위에 노란 띠(개발·테스트 환경)가 보이면 정상입니다.

---

## 인터넷 주소 (운영 중)

**https://hyangmiok.netlify.app**

- 무료 호스팅 **Netlify**(사업용 무료 허용)에 올라가 있습니다. 매달 300포인트가 무료로 주어지고, **새 버전을 올릴 때마다 15포인트**가 듭니다.
- 그래서 프로그램을 고칠 때마다 바로 올리지 않고, 모아서 주 1~2회만 올립니다 (커밋 메시지에 `[deploy]` 를 넣을 때만 올라감 — `netlify.toml` 참고).
- Supabase 연결 정보(열쇠 3개)는 Netlify → **환경 변수**에 들어 있습니다. 바꾸면 다시 올려야 반영됩니다.
- Netlify 화면에서 포인트 사용량을 확인할 수 있습니다. 포인트를 다 쓰면 다음 달까지 사이트가 멈추니, 70% 이상 쓰면 알려주세요.

### 휴대폰 홈 화면에 앱처럼 추가하기
- **아이폰(사파리)**: 주소 열기 → 아래 가운데 **공유 버튼(네모에 화살표)** → **홈 화면에 추가**
- **갤럭시(크롬·삼성인터넷)**: 주소 열기 → 오른쪽 위 **⋮ (점 3개)** → **홈 화면에 추가**
- 한 번 로그인하면 로그아웃하기 전까지 자동 로그인됩니다.
## 사용 설명서
- 관리자(대표) 사용법: [docs/ADMIN_MANUAL.md](docs/ADMIN_MANUAL.md)
- 시스템 구조·데이터 설계·개발 계획: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 구현·검증 현황: [docs/STATUS.md](docs/STATUS.md)

## 개발자용
```bash
npm run check   # 타입검사 + 린트 + 테스트
npm run build   # 프로덕션 빌드 확인
```
개발 규칙은 [CLAUDE.md](CLAUDE.md) 를 참고하세요.

## 문제 해결
| 증상 | 해결 |
|---|---|
| 로그인 화면에 "초기 설정이 필요합니다" | `.env.local` 이 없거나 값이 틀림 → 3단계 확인 후 `npm run dev` 다시 실행 |
| "승인 대기 중이거나 사용이 중지된 계정" | 대표가 [계정 관리]에서 '사용 중' 체크 필요. 대표 본인이면 2단계-5 SQL 재실행 |
| "아이디 또는 비밀번호가 올바르지 않습니다" | 아이디·비밀번호 확인. 잊었으면 대표에게 초기화 요청 |
| 계정 만들기에서 "SUPABASE_SECRET_KEY 가 설정되지 않아" | `.env.local`(또는 Vercel 환경변수)에 Secret key 입력 후 재시작 |
