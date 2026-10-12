-- =====================================================================
-- 거래명세표 사진 → AI 자동 읽기 → 올린 사람이 확인 후 확정
-- ---------------------------------------------------------------------
-- 대표 결정 (2026-10-13)
--  * 거래처를 고르고 거래명세표를 사진 찍어 올리면 AI(Claude Opus 5.5)가 품목·수량·단가·금액·잔액을 읽는다
--  * 사진을 올린 사람이 직접 확인하고, AI 가 못 읽은 칸은 손으로 적는다
--  * 사진은 보관한다 (Storage 비공개 버킷 'statements', 지점별 폴더, 덮어쓰기·삭제 불가)
-- 권한
--  * 올리기·확인(확정)·버리기: 대표, 소속 본사 관리자, 소속 지점 관리자 (app.can_manage_store)
--    지점 관리자는 지출 표를 볼 수도 쓸 수도 없으므로, 확정은 SECURITY DEFINER 함수
--    confirm_purchase_statement 하나로만 '식재료 지출 + 품목 줄'을 만든다 (그 거래명세표 1장 분량만).
--  * 확정된 지출의 수정·삭제는 지금처럼 대표만 (지출 입력 화면)
--  * 직원: 접근 불가
--  * 표의 상태 변경은 아래 함수로만 (직접 UPDATE 정책 없음) → AI 결과 위조로 '확정' 상태를 만들 수 없다
-- AI 비용 보호: 한 장당 AI 읽기 최대 3번, 지점당 하루 최대 50장
-- =====================================================================

-- 1) 거래명세표
create table public.purchase_statements (
  id                 uuid primary key default gen_random_uuid(),
  store_id           uuid not null references public.stores (id) on delete restrict,
  vendor_id          uuid not null references public.vendors (id) on delete restrict,
  photo_path         text not null unique,
  photo_bytes        integer not null check (photo_bytes between 1 and 5242880),
  status             text not null default 'uploaded'
                     check (status in ('uploaded', 'read', 'failed', 'confirmed', 'discarded')),
  ai_result          jsonb,
  ai_model           text check (ai_model is null or char_length(ai_model) <= 60),
  ai_error           text check (ai_error is null or char_length(ai_error) <= 300),
  ai_attempts        smallint not null default 0 check (ai_attempts between 0 and 3),
  ai_usage           jsonb,
  ai_read_at         timestamptz,
  statement_date     date,
  statement_total    bigint check (statement_total is null or statement_total between 0 and 9999999999),
  statement_balance  bigint check (statement_balance is null or statement_balance between -9999999999 and 9999999999),
  confirmed_total    bigint check (confirmed_total is null or confirmed_total between 1 and 9999999999),
  memo               text check (memo is null or char_length(memo) <= 200),
  expense_id         uuid references public.expenses (id) on delete set null,
  confirmed_by       uuid references public.profiles (id) on delete set null,
  confirmed_at       timestamptz,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.profiles (id) on delete set null,
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.profiles (id) on delete set null,
  -- 사진은 반드시 그 지점 폴더: <store_id>/<YYYY-MM>/<uuid>.jpg
  constraint purchase_statements_photo_path_check
    check (photo_path ~ ('^' || store_id::text || '/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}[.]jpg$'))
);

create index purchase_statements_store_created_idx on public.purchase_statements (store_id, created_at desc);
create index purchase_statements_vendor_date_idx on public.purchase_statements (store_id, vendor_id, statement_date);
create index purchase_statements_expense_idx on public.purchase_statements (expense_id);

comment on table public.purchase_statements is
  '거래명세표 사진과 AI 읽기 결과. 올린 사람이 확인해 확정하면 식재료 지출(+품목 줄)이 만들어진다 (expense_id).';
comment on column public.purchase_statements.ai_result is 'AI 가 읽은 원본(검토 참고용). 확정 금액은 expenses / expense_lines 가 기준';
comment on column public.purchase_statements.statement_balance is '거래명세표에 적힌 잔액(미수). 장부 미수와 비교용';
comment on column public.purchase_statements.confirmed_total is '확정한 금액(품목+부가세 합계 = 만들어진 지출 금액). 지점 관리자는 지출 표를 못 보므로 여기서 확인';

-- 새 거래명세표는 항상 '올림' 상태로 시작 (AI 결과·확정 정보를 직접 넣을 수 없다)
-- SECURITY DEFINER: 거래처 확인이 호출자의 거래처 조회 권한과 무관하게 동작 (권한 판단은 RLS 가 따로 한다)
create or replace function app.guard_new_statement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.status := 'uploaded';
  new.ai_result := null;
  new.ai_model := null;
  new.ai_error := null;
  new.ai_attempts := 0;
  new.ai_usage := null;
  new.ai_read_at := null;
  new.statement_date := null;
  new.statement_total := null;
  new.statement_balance := null;
  new.confirmed_total := null;
  new.expense_id := null;
  new.confirmed_by := null;
  new.confirmed_at := null;
  if not exists (select 1 from public.vendors v where v.id = new.vendor_id and v.is_active) then
    raise exception '거래 중인 거래처가 아닙니다.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger purchase_statements_new before insert on public.purchase_statements
  for each row execute function app.guard_new_statement();
create trigger purchase_statements_stamp before insert or update on public.purchase_statements
  for each row execute function app.stamp_actor();
create trigger purchase_statements_audit after insert or update or delete on public.purchase_statements
  for each row execute function app.audit_row_change();

-- 2) AI 읽기 시작: 권한·횟수 확인 후 시도 횟수 +1 (AI 를 부르기 '전'에 기록 → 동시에 여러 번 눌러도 비용이 새지 않음)
create or replace function public.begin_statement_ai(p_statement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.purchase_statements%rowtype;
  v_vendor text;
  v_today_count integer;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  select * into s from public.purchase_statements where id = p_statement_id for update;
  if not found or not app.can_manage_store(s.store_id) then
    raise exception '거래명세표를 찾을 수 없거나 권한이 없습니다.' using errcode = '42501';
  end if;
  if s.status in ('confirmed', 'discarded') then
    raise exception '이미 처리된 거래명세표입니다.' using errcode = '22023';
  end if;
  if s.ai_attempts >= 3 then
    raise exception 'AI 읽기는 한 장에 3번까지예요. 직접 적어 주세요.' using errcode = '22023';
  end if;
  select count(*) into v_today_count
  from public.purchase_statements p
  where p.store_id = s.store_id
    and p.ai_read_at >= (app.seoul_today()::timestamp at time zone 'Asia/Seoul');
  if v_today_count >= 50 and (s.ai_read_at is null or s.ai_read_at < (app.seoul_today()::timestamp at time zone 'Asia/Seoul')) then
    raise exception '오늘 이 지점에서 AI 로 읽을 수 있는 50장을 다 썼어요. 직접 적어 주세요.' using errcode = '22023';
  end if;

  update public.purchase_statements
  set ai_attempts = ai_attempts + 1,
      ai_read_at = now(),
      ai_error = null
  where id = s.id;

  select v.name into v_vendor from public.vendors v where v.id = s.vendor_id;
  return jsonb_build_object('photo_path', s.photo_path, 'vendor_name', v_vendor, 'attempt', s.ai_attempts + 1);
end;
$$;

-- 3) AI 읽기 결과 기록 (성공 → read, 실패 → failed)
create or replace function public.finish_statement_ai(
  p_statement_id uuid,
  p_ok boolean,
  p_result jsonb,
  p_model text,
  p_usage jsonb,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.purchase_statements%rowtype;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  select * into s from public.purchase_statements where id = p_statement_id for update;
  if not found or not app.can_manage_store(s.store_id) then
    raise exception '거래명세표를 찾을 수 없거나 권한이 없습니다.' using errcode = '42501';
  end if;
  if s.status in ('confirmed', 'discarded') then
    raise exception '이미 처리된 거래명세표입니다.' using errcode = '22023';
  end if;
  if s.ai_attempts = 0 then
    raise exception 'AI 읽기를 시작하지 않았습니다.' using errcode = '22023';
  end if;
  if p_ok and (p_result is null or jsonb_typeof(p_result) <> 'object' or octet_length(p_result::text) > 200000) then
    raise exception 'AI 결과 형식이 올바르지 않습니다.' using errcode = '22023';
  end if;

  update public.purchase_statements
  set status = case when p_ok then 'read' else (case when s.status = 'read' then 'read' else 'failed' end) end,
      ai_result = case when p_ok then p_result else s.ai_result end,
      ai_model = left(p_model, 60),
      ai_usage = case when p_usage is not null and octet_length(p_usage::text) <= 4000 then p_usage end,
      ai_error = case when p_ok then null else left(coalesce(p_error, 'AI 가 읽지 못했습니다.'), 300) end
  where id = s.id;
end;
$$;

-- 4) 확정: 확인한 내용으로 식재료 지출 + 품목 줄을 만든다
--    p_lines: [{"item_name","quantity","unit","unit_price","amount"}, ...]  (부가세는 '부가세' 줄로 함께 보낸다)
create or replace function public.confirm_purchase_statement(
  p_statement_id uuid,
  p_date date,
  p_lines jsonb,
  p_on_credit boolean,
  p_statement_total bigint,
  p_statement_balance bigint,
  p_memo text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.purchase_statements%rowtype;
  v_vendor public.vendors%rowtype;
  v_category uuid;
  v_count integer;
  v_total bigint;
  v_expense uuid;
  v_bad integer;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  select * into s from public.purchase_statements where id = p_statement_id for update;
  if not found or not app.can_manage_store(s.store_id) then
    raise exception '거래명세표를 찾을 수 없거나 권한이 없습니다.' using errcode = '42501';
  end if;
  if s.status in ('confirmed', 'discarded') then
    raise exception '이미 처리된 거래명세표입니다.' using errcode = '22023';
  end if;

  -- 날짜: 미래 금지, 대표가 아니면 최근 31일 안에서만
  if p_date is null or p_date > app.seoul_today() then
    raise exception '날짜를 확인하세요 (미래 날짜는 안 됩니다).' using errcode = '22023';
  end if;
  if not app.is_owner() and p_date < app.seoul_today() - 31 then
    raise exception '31일보다 오래된 거래명세표는 대표만 확정할 수 있습니다.' using errcode = '22023';
  end if;

  -- 품목 줄 검사
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception '품목 형식이 올바르지 않습니다.' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_lines);
  if v_count < 1 or v_count > 50 then
    raise exception '품목은 1~50줄이어야 합니다.' using errcode = '22023';
  end if;
  select count(*) into v_bad
  from jsonb_array_elements(p_lines) as l
  where case
    when jsonb_typeof(l) <> 'object' then true
    when char_length(btrim(coalesce(l ->> 'item_name', ''))) not between 1 and 60 then true
    when coalesce(l ->> 'quantity', '') !~ '^[0-9]{1,9}([.][0-9]{1,3})?$' then true
    when (l ->> 'quantity')::numeric <= 0 then true
    when char_length(coalesce(l ->> 'unit', '')) > 10 then true
    when coalesce(l ->> 'unit_price', '') !~ '^[0-9]{1,9}$' then true
    when coalesce(l ->> 'amount', '') !~ '^[0-9]{1,10}$' then true
    else false
  end;
  if v_bad > 0 then
    raise exception '품목 줄 %개가 비었거나 숫자가 올바르지 않습니다.', v_bad using errcode = '22023';
  end if;
  select sum((l ->> 'amount')::bigint) into v_total from jsonb_array_elements(p_lines) as l;
  if v_total < 1 or v_total > 9999999999 then
    raise exception '합계 금액을 확인하세요.' using errcode = '22023';
  end if;

  select * into v_vendor from public.vendors where id = s.vendor_id;
  v_category := coalesce(
    v_vendor.default_category_id,
    (select c.id from public.expense_categories c where c.code = 'food')
  );

  insert into public.expenses (store_id, expense_date, category_id, vendor, vendor_id, description, amount, basis, on_credit)
  values (
    s.store_id,
    p_date,
    v_category,
    left(v_vendor.name, 60),
    v_vendor.id,
    left(concat_ws(' · ', '거래명세표 사진', nullif(btrim(coalesce(p_memo, '')), '')), 200),
    v_total,
    'actual',
    coalesce(p_on_credit, v_vendor.on_credit)
  )
  returning id into v_expense;

  insert into public.expense_lines (expense_id, line_no, item_name, quantity, unit, unit_price, amount)
  select v_expense,
         t.ord,
         btrim(t.l ->> 'item_name'),
         (t.l ->> 'quantity')::numeric,
         nullif(btrim(coalesce(t.l ->> 'unit', '')), ''),
         (t.l ->> 'unit_price')::bigint,
         (t.l ->> 'amount')::bigint
  from jsonb_array_elements(p_lines) with ordinality as t(l, ord);

  update public.purchase_statements
  set status = 'confirmed',
      expense_id = v_expense,
      statement_date = p_date,
      statement_total = p_statement_total,
      statement_balance = p_statement_balance,
      confirmed_total = v_total,
      memo = nullif(left(btrim(coalesce(p_memo, '')), 200), ''),
      confirmed_by = auth.uid(),
      confirmed_at = now()
  where id = s.id;

  return v_expense;
end;
$$;

-- 5) 버리기 (잘못 찍은 사진 등). 사진과 기록은 남는다
create or replace function public.discard_purchase_statement(p_statement_id uuid, p_memo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.purchase_statements%rowtype;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  select * into s from public.purchase_statements where id = p_statement_id for update;
  if not found or not app.can_manage_store(s.store_id) then
    raise exception '거래명세표를 찾을 수 없거나 권한이 없습니다.' using errcode = '42501';
  end if;
  if s.status = 'confirmed' then
    raise exception '이미 확정된 거래명세표는 버릴 수 없습니다. 대표가 지출 입력 화면에서 고쳐 주세요.' using errcode = '22023';
  end if;
  update public.purchase_statements
  set status = 'discarded',
      memo = nullif(left(btrim(coalesce(p_memo, '')), 200), '')
  where id = s.id;
end;
$$;

-- 6) 지점 관리자도 거래처 이름을 고를 수 있게 (거래 중인 거래처만, 소속 지점 연결만)
create policy vendors_select_store_manager on public.vendors
  for select to authenticated
  using (app.my_role() = 'store_manager' and is_active);
create policy vendor_stores_select_manager on public.vendor_stores
  for select to authenticated
  using (app.can_manage_store(store_id));

-- =====================================================================
-- 권한 · RLS
-- =====================================================================
revoke all on public.purchase_statements from anon, authenticated;
grant select, insert on public.purchase_statements to authenticated;

revoke all on function app.guard_new_statement() from public;
grant execute on function app.guard_new_statement() to authenticated, service_role;

revoke all on function public.begin_statement_ai(uuid) from public, anon;
revoke all on function public.finish_statement_ai(uuid, boolean, jsonb, text, jsonb, text) from public, anon;
revoke all on function public.confirm_purchase_statement(uuid, date, jsonb, boolean, bigint, bigint, text) from public, anon;
revoke all on function public.discard_purchase_statement(uuid, text) from public, anon;
grant execute on function public.begin_statement_ai(uuid) to authenticated;
grant execute on function public.finish_statement_ai(uuid, boolean, jsonb, text, jsonb, text) to authenticated;
grant execute on function public.confirm_purchase_statement(uuid, date, jsonb, boolean, bigint, bigint, text) to authenticated;
grant execute on function public.discard_purchase_statement(uuid, text) to authenticated;

alter table public.purchase_statements enable row level security;

create policy purchase_statements_select on public.purchase_statements
  for select to authenticated using (app.can_manage_store(store_id));
create policy purchase_statements_insert on public.purchase_statements
  for insert to authenticated with check (app.can_manage_store(store_id));
-- UPDATE/DELETE 정책 없음: 상태 변경은 위 함수로만, 기록은 지우지 않는다

-- =====================================================================
-- 사진 보관함 (Supabase Storage): 비공개, 5MB 이하 JPEG 만
-- 경로 <store_id>/<YYYY-MM>/<uuid>.jpg — 첫 폴더(지점)로 권한 확인. 덮어쓰기·삭제 정책 없음
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('statements', 'statements', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

create or replace function app.statement_photo_store(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := split_part(coalesce(p_name, ''), '/', 1);
begin
  if v ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return v::uuid;
  end if;
  return null;
end;
$$;

revoke all on function app.statement_photo_store(text) from public;
grant execute on function app.statement_photo_store(text) to authenticated, service_role;

create policy statements_photo_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'statements'
    and name ~ '^[0-9a-f-]{36}/[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}[.]jpg$'
    and app.statement_photo_store(name) is not null
    and app.can_manage_store(app.statement_photo_store(name))
  );
create policy statements_photo_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'statements'
    and app.statement_photo_store(name) is not null
    and app.can_manage_store(app.statement_photo_store(name))
  );
