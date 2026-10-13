-- =====================================================================
-- 밤 9시 텔레그램 발주 전송 설정 — 대표가 Supabase SQL Editor 에서 한 번만 실행
-- (마이그레이션 20261013000900_orders.sql 을 먼저 적용해야 합니다)
-- ---------------------------------------------------------------------
-- 할 일: 아래 '여기에_봇_토큰', '여기에_방_번호' 두 곳만 바꾸고 Run
--   봇 토큰 = 지금 쓰는 구글 앱스 스크립트 '향미옥 발주' 안의 긴 글자 (예: 1234567890:AAH...)
--   방 번호 = 같은 스크립트 안의 chat_id (단체방이면 보통 -100 으로 시작하는 숫자)
--   ※ 따옴표(' ')는 지우지 마세요. 토큰은 채팅·메모에 붙여넣지 마세요.
-- 끝나면: 앱 [발주 품목 관리] → [텔레그램 시험 전송] 으로 확인
--        그리고 구글 앱스 스크립트의 밤 9시 자동 실행(트리거)은 꺼 주세요 (두 번 가지 않게)
-- =====================================================================

-- 1) 필요한 기능 켜기 (이미 켜져 있으면 그냥 넘어감)
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- 2) 봇 토큰 · 방 번호를 금고(Vault)에 보관
select vault.create_secret('여기에_봇_토큰', 'telegram_bot_token', '향미옥 발주 텔레그램 봇 토큰');
select vault.create_secret('여기에_방_번호', 'telegram_chat_id', '향미옥 발주 텔레그램 방 번호');

-- 3) 매일 밤 9시(한국) = 12:00 UTC 에 오늘 완료된 발주 보내기
select cron.schedule('hyangmiok-orders-2100', '0 12 * * *', $$select app.send_daily_orders()$$);

-- ---------------------------------------------------------------------
-- (참고) 나중에 토큰·방 번호를 바꿀 때: 아래처럼 실행 (위 2번은 다시 실행하면 '이미 있음' 오류가 납니다)
--   select vault.update_secret((select id from vault.secrets where name = 'telegram_bot_token'), '새_봇_토큰');
--   select vault.update_secret((select id from vault.secrets where name = 'telegram_chat_id'), '새_방_번호');
-- (참고) 밤 9시 전송을 멈출 때:  select cron.unschedule('hyangmiok-orders-2100');
-- (참고) 전송 기록 보기:          select * from cron.job_run_details order by start_time desc limit 10;
-- =====================================================================
