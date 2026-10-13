-- 향미옥 발주 → 매일 밤 9시 텔레그램 자동 전송 설정 (대표가 Supabase SQL Editor 에서 실행)
-- ✋ 바꿀 곳은 바로 아래 ①, ② 줄의 한글 두 군데뿐입니다.
--    한글 글자를 더블클릭(파랗게 선택) → Ctrl+V 로 붙여넣기. 양옆 $t$ 는 그대로 두세요.
do $setup$ declare
  v_token text := $t$여기에_봇_토큰$t$;   -- ① 봇 토큰 (예: 1234567890:AAH...)
  v_chat  text := $t$여기에_방_번호$t$;   -- ② 방 번호 (예: -1001234567890, 앞에 - 가 있으면 - 까지)
  v_id uuid;
begin
  -- 같이 복사된 따옴표·띄어쓰기는 지우고, 주소째 붙여넣어도 토큰 부분만 골라 씀
  v_token := (regexp_match(v_token, '[0-9]{5,}:[A-Za-z0-9_-]{30,}'))[1];
  v_chat := regexp_replace(v_chat, '[\s''"`]', '', 'g');
  if v_token is null then
    raise exception '① 여기에_봇_토큰 자리에 봇 토큰(숫자:영어 섞인 긴 글자)을 처음부터 끝까지 붙여넣고 다시 Run 하세요';
  end if;
  if v_chat !~ '^(-?[0-9]{5,}|@[A-Za-z0-9_]{5,})$' then
    raise exception '② 여기에_방_번호 자리에 방 번호(숫자, 앞에 - 가 있으면 - 까지)를 붙여넣고 다시 Run 하세요';
  end if;

  -- 금고(Vault)에 보관: 처음이면 새로 넣고, 이미 있으면 바꿔 씀 (잘못 넣었으면 고쳐서 다시 Run)
  select id into v_id from vault.decrypted_secrets where name = 'telegram_bot_token';
  if v_id is null then
    perform vault.create_secret(v_token, 'telegram_bot_token', '향미옥 발주 텔레그램 봇 토큰');
  else
    perform vault.update_secret(v_id, v_token);
  end if;
  select id into v_id from vault.decrypted_secrets where name = 'telegram_chat_id';
  if v_id is null then
    perform vault.create_secret(v_chat, 'telegram_chat_id', '향미옥 발주 텔레그램 방 번호');
  else
    perform vault.update_secret(v_id, v_chat);
  end if;
end $setup$;

-- ---------------------------------------------------------------------
-- 여기부터는 고치지 마세요 (이미 켜져 있거나 예약돼 있으면 그대로 덮어씀)
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- 매일 밤 9시(한국) = 12:00 UTC 에 완료된 발주 보내기
select '설정 완료 → 앱 [발주 품목 관리] 에서 [텔레그램 시험 전송]' as "결과",
  cron.schedule('hyangmiok-orders-2100', '0 12 * * *', $$select app.send_daily_orders()$$) as "예약 번호";

-- ---------------------------------------------------------------------
-- 끝나면: 구글 앱스 스크립트 '향미옥 발주'의 밤 9시 자동 실행(트리거)을 꺼 주세요 (두 번 가지 않게)
-- (참고) 토큰·방 번호를 바꿀 때: 위 ①, ② 만 고쳐서 이 글 전체를 다시 Run
-- (참고) 밤 9시 전송을 멈출 때:  select cron.unschedule('hyangmiok-orders-2100');
-- (참고) 전송 기록 보기:          select * from cron.job_run_details order by start_time desc limit 10;
