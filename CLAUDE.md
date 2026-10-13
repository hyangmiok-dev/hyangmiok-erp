@AGENTS.md

# 향미옥 경영관리 시스템 — 프로젝트 규칙

한국식 쌀국수 '향미옥' 3개 직영점 통합 경영관리 웹앱. 대표가 매장에 가지 않아도 숫자로 관리하는 것이 목표.
설계 전체는 `docs/ARCHITECTURE.md`, 단계별 진행 현황은 `docs/STATUS.md`.

## 명령어
```bash
npm run dev         # 개발 서버 (http://localhost:3000)
npm run check       # 타입검사 + 린트 + 테스트 (커밋 전 필수)
npm run build       # 프로덕션 빌드
npm test            # Vitest (unit + PGlite DB/RLS 테스트)
```
- Windows: 프로젝트 경로에 한글이 있어도 동작함. 단 아주 긴 경로(임시폴더 등)에서 npm install 시 `spawn cmd.exe ENOENT` 발생 가능.

## 스택
Next.js 16.4 (App Router, Turbopack, **Cache Components 활성**) · React 19 · TypeScript strict · Tailwind 4 · shadcn/ui(**Base UI 기반 — `asChild` 대신 `render` prop**) · Supabase(Postgres, Auth, RLS) · Zod 4 · Vitest + PGlite.

## 절대 규칙
1. **권한은 DB(RLS)가 최종 강제.** 새 테이블은 반드시 `enable row level security` + 정책 + `revoke ... from anon` + 필요한 grant 만. 앱 코드의 숨김은 보조일 뿐.
2. 모든 지점 데이터 테이블은 `store_id uuid not null references stores` 를 갖고 `app.has_store_access` / `app.can_manage_store` / `app.can_view_store_financials` 로 정책 작성.
3. `src/lib/auth/roles.ts` 의 규칙은 `app.*` SQL 함수와 **같은 의미**를 유지. 하나를 바꾸면 둘 다 + 테스트 수정.
4. 서버 액션 시작 시 `authorizeAction([...])`, 페이지는 `requireUser()` / `requireRole([...])`. 입력은 Zod 로 서버에서 검증.
5. Secret key(`createAdminClient`)는 Auth 관리 작업에만. 업무 데이터 쓰기는 사용자 세션 `createClient()` 로 (감사로그에 수행자 남김).
6. 금액은 원 단위 정수(bigint). 부동소수점 누적 금지. 표시는 `formatKRW`. **값 없음은 '미입력'**, 0 으로 나눔은 `safeDivide` → '계산불가'.
7. 날짜는 Asia/Seoul. 영업일 키는 `seoulDateKey()`. `new Date().toISOString().slice(0,10)` 금지(UTC).
8. 확인되지 않은 사업 정보(주소·좌석수 등)를 임의로 채우지 않는다 → NULL.
9. 예시/테스트 데이터는 운영 DB 에 넣지 않는다. **현재 Supabase 프로젝트는 하나뿐이며 실전(운영)용이다 (대표 결정 2026-10-13)** — 로컬 `.env.local` 도 운영 DB 를 가리킨다. 따라서 로컬에서 쓰기 테스트·시드 금지, 점검은 읽기 전용(`scripts/verify-supabase.mjs`)만. 새 기능 시험은 PGlite 테스트로 하고, 실 DB 시험이 꼭 필요하면 개발용 프로젝트를 새로 만들어 `setup-new-project.sql` 로 구성한다.
10. 급여·법정수당 계산은 '검증 전 초안'으로만 표시. 확정 급여처럼 보이게 하지 말 것.
11. 실제로 실행·검증하지 않은 기능은 `docs/STATUS.md` 에 완료로 표시하지 않는다.

## Next.js 16 주의
- 미들웨어는 `src/proxy.ts` (export `proxy`).
- 세션(쿠키)을 읽는 서버 컴포넌트는 `<Suspense>` 안에서 렌더. 패턴: `page.tsx` 는 Suspense 껍데기, 내부 async 컴포넌트에서 `requireUser()`.
- 재무 데이터에 `use cache` 사용 금지 (항상 최신값).
- `forbidden()`/`unauthorized()` 는 실험 기능 → 사용하지 않음 (`/forbidden` 리다이렉트).
- API/규칙이 헷갈리면 `node_modules/next/dist/docs/` 를 먼저 읽을 것.

## DB 변경 절차
1. `supabase/migrations/YYYYMMDDHHMMSS_설명.sql` 새 파일 추가 (기존 적용된 파일 수정 금지).
2. `tests/db/` 에 RLS·무결성 테스트 추가 → `node scripts/build-setup-sql.mjs`(새 프로젝트용 통합 SQL 갱신) → `npm test` (PGlite 가 실제 SQL 을 실행, 통합 SQL 불일치도 검사).
3. Supabase 적용: 운영 프로젝트 SQL Editor 에 **새 마이그레이션 파일만** 붙여넣기 (대표가 실행). 적용 전 PGlite 테스트 통과 필수. 적용 확인: `node --env-file=.env.local scripts/verify-supabase.mjs` (로컬은 개발 프로젝트).
4. 보안 정의 함수는 `security definer` + `set search_path = ''` + 완전한 스키마명. 단, 호출자 역할(`current_user`)이 필요한 트리거는 `security invoker`.

## 배포 (Netlify 무료 — 대표 결정 2026-10-13)
- GitHub `hyangmiok-dev/hyangmiok-erp` 의 main 이 Netlify 운영 브랜치. **무료는 성공한 운영 배포 1번 = 15포인트(월 300)**.
- `netlify.toml` 의 `ignore` 때문에 **커밋 메시지에 `[deploy]` 가 있을 때만 배포**된다. 평소 커밋은 건너뜀(포인트 0).
  배포할 때: `git commit --allow-empty -m "[deploy] 배포: 무엇을 바꿨는지"` → `git push`. 주 1~2회로 모아서.
- 환경변수(Netlify 화면에서 대표가 입력): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`. `NEXT_PUBLIC_APP_ENV=production` 은 netlify.toml.
  NEXT_PUBLIC_* 는 빌드 때 박히므로 값을 바꾸면 다시 배포해야 반영된다.
- 이 셸(Claude)에서는 git 로그인 창을 못 띄운다 → 처음 push 는 터미널 탭에서 `git -c credential.gitHubAuthModes=device push` 로 대표가 코드 입력. 이후 push 는 저장된 인증으로 동작.
- Cloudflare Workers 설정(`wrangler.jsonc`, `open-next.config.ts`, `cloudflare/postbuild.mjs`, `npm run cf:*`)은 예비용으로 남겨 둠. 무료 플랜 CPU 10ms 제한 때문에 보류.
  Cache Components 는 Cloudflare(workerd) 호환 문제로 꺼 둠 (`next.config.ts` 주석).
- Vercel 은 무료(Hobby)가 비상업 전용이라 사용하지 않음.

## 전표 입력 (1000) — 현재 쓰는 입고 기록 방법
- 대표 결정 2026-10-13 밤: 텔레그램·앱 발주 쓰지 않음. `/slips` 에서 거래처마다 그 날 전표 **총금액 하나** (직원 포함 모두).
- `expenses.is_slip` + 부분 유니크 인덱스(지점·날짜·거래처). 읽기·쓰기는 `slip_sheet`·`save_slips`·`slip_days` (SECURITY DEFINER, `app.has_store_access`, 대표 외 7일).
  0 이면 지움, 품목 줄이 붙은 전표는 금액 변경 거부. 미수 잔액·원가율은 페이지에서 대표·본사 관리자에게만 기존 함수(`summarizePayables`, `computeStorePnl`)로 계산.
- 아래 0900 발주·입고 확인, 0800 발주 없이 입고, 발주 품목 관리는 **메뉴에서만 숨김** (화면·DB 그대로, `NAV_ITEMS` 에 다시 넣으면 켜짐).

## 발주 · 입고 확인 (0900) — 메뉴에서 숨김
- `/orders`(저녁 발주, 직원 포함) → `app.send_daily_orders()` 를 pg_cron 이 매일 12:00 UTC(밤 9시 한국)에 실행 → 텔레그램(pg_net, Vault `telegram_bot_token`/`telegram_chat_id`) → `/receiving`(아침, 줄마다 같음/다름/안 옴 → `complete_receipt` 가 지출 생성).
- 텔레그램 설정 SQL 은 마이그레이션이 아니라 `supabase/telegram-setup.sql`(대표가 토큰을 직접 넣어 1회 실행). PGlite 테스트는 vault/net 을 모사한다(stage3g). 설정 SQL 자체도 `tests/db/telegram-setup.test.ts` 가 실행해 본다(①② 자리 바꾸기·다시 실행·잘못된 값 거부).
- 발주 날짜 규칙: 한국 시간 21시 이후 발주는 다음 날 (`app.order_day()` = `orderDay()`), 보낸 발주는 잠금.

## 입고 입력 (거래명세표)
- 대표 결정 2026-10-13: 거래명세표 **사진 AI 읽기는 오류·지연이 많아 없앰**(Claude → Gemini 무료로 시험 후 중단). 대신 `/deliveries` 빠른 입고 입력.
  0700 마이그레이션의 `purchase_statements`·`statements` 버킷·관련 함수는 DB 에 남아 있지만 앱에서 쓰지 않는다 (Storage 는 SQL 로 지우면 막히므로 그대로 둠). 코드는 git 기록에 있음.
- 지점 관리자도 입고를 입력하지만 지출 표는 못 본다 → `record_delivery`·`delivery_items`·`recent_deliveries`·`cancel_delivery` (0800, SECURITY DEFINER, `app.can_manage_store` 검사, 금액은 DB 가 수량×단가로 계산).
- Supabase CLI 는 로그인되어 있음(`npx supabase@2.118.0 ...`, 이 셸의 PowerShell 은 `npx` 대신 `npx.cmd` 가 필요할 수 있음 — 실행 정책). Edge Function 은 현재 없음.
## 폴더
- `src/app/(app)/` 로그인 후 화면, `src/app/login/` 로그인
- `src/lib/auth/` 권한 규칙·DAL, `src/lib/data/` 조회(server-only), `src/lib/validation/` Zod
- `src/components/ui/` shadcn 원본(가급적 수정 금지), `src/components/` 공통 컴포넌트
- `tests/db/harness.ts` — `createTestDb()`, `asUser(db, userId, fn)` 로 역할별 쿼리 테스트

## UI 규칙
- 한국어, 원화, `ko-KR` 형식. PC=좌측 사이드바 대시보드, 모바일=상단바+시트 메뉴, 입력 요소 높이 ≥ 40px, 글자 16px(iOS 확대 방지).
- 로딩(`LoadingState`) / 오류(`ErrorState`) / 데이터 없음(`EmptyState`) 을 구분해 표시.
- 각 수치에는 최종 갱신시각·출처를 표시(2단계부터).
- 메뉴 정의는 `NAV_ITEMS` (roles.ts). 단계 완료 시 `CURRENT_STAGE` 올리기.
