-- =====================================================================
-- 2단계: 일별 매출 + CSV 일괄 등록
-- ---------------------------------------------------------------------
-- 입력 기준 (대표 결정 2026-10-13)
--  * 점장(또는 부점장, 둘 다 '지점 관리자')이 POS 마감 영수증을 보고 입력
--  * 필수 입력: 실매출(할인·취소 뺀 순매출) + 건수(영수증 건수)
--  * 휴무일은 '휴무'로 명시 → 미입력과 구분
--  * 나머지 항목(총매출·할인·카드·현금 등)은 POS 연동/상세 입력 대비 선택 컬럼
-- 무결성
--  * 지점+영업일 1건 (UNIQUE) → 중복 입력 불가
--  * 미래 날짜 불가, 대표가 아니면 7일 이전 매출은 입력·수정 불가
--  * 모든 변경은 감사로그(수정 이력)에 변경 전/후로 남음
-- =====================================================================

create table public.import_batches (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null default 'daily_sales' check (kind in ('daily_sales')),
  file_name    text check (file_name is null or char_length(file_name) <= 200),
  row_count    integer not null default 0 check (row_count >= 0),
  inserted     integer not null default 0,
  updated      integer not null default 0,
  skipped      integer not null default 0,
  created_by   uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);

create table public.daily_sales (
  id               uuid primary key default gen_random_uuid(),
  store_id         uuid not null references public.stores (id) on delete restrict,
  business_date    date not null,
  is_closed        boolean not null default false,
  -- 필수: 실매출(원) · 건수
  net_sales        bigint  not null check (net_sales between 0 and 99999999999),
  order_count      integer not null check (order_count between 0 and 99999),
  -- 선택: 상세 / POS 연동 대비 (NULL = 미입력)
  gross_sales      bigint  check (gross_sales is null or gross_sales >= 0),
  discount_amount  bigint  check (discount_amount is null or discount_amount >= 0),
  refund_amount    bigint  check (refund_amount is null or refund_amount >= 0),
  card_amount      bigint  check (card_amount is null or card_amount >= 0),
  cash_amount      bigint  check (cash_amount is null or cash_amount >= 0),
  delivery_sales   bigint  check (delivery_sales is null or delivery_sales >= 0),
  customer_count   integer check (customer_count is null or customer_count >= 0),
  memo             text    check (memo is null or char_length(memo) <= 500),
  source           text    not null default 'manual' check (source in ('manual', 'csv', 'pos')),
  import_batch_id  uuid    references public.import_batches (id) on delete set null,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles (id) on delete set null,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles (id) on delete set null,
  constraint daily_sales_store_date_key unique (store_id, business_date),
  constraint daily_sales_closed_zero check (not is_closed or (net_sales = 0 and order_count = 0))
);

create index daily_sales_date_idx on public.daily_sales (business_date);

comment on table public.daily_sales is
  '지점별 일 매출. net_sales=실매출(할인·취소 차감 후), order_count=POS 영수증 건수. 행이 없으면 미입력.';

-- 한국 날짜 기준 오늘
create or replace function app.seoul_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Seoul')::date
$$;

-- 입력자 기록 · 날짜 규칙 · 지점 변경 금지
create or replace function app.guard_daily_sales()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_privileged boolean :=
    current_user in ('postgres', 'service_role', 'supabase_admin') or app.is_owner();
  v_today date := app.seoul_today();
begin
  if new.business_date > v_today then
    raise exception '미래 날짜(%)의 매출은 입력할 수 없습니다.', new.business_date using errcode = '22023';
  end if;

  if not v_privileged then
    if new.business_date < v_today - 7
       or (tg_op = 'UPDATE' and old.business_date < v_today - 7) then
      raise exception '7일이 지난 매출은 대표만 입력·수정할 수 있습니다.' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    if new.store_id is distinct from old.store_id then
      raise exception '매출의 지점은 바꿀 수 없습니다. 삭제 후 다시 입력하세요.' using errcode = '22023';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;

  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

create trigger daily_sales_guard before insert or update on public.daily_sales
  for each row execute function app.guard_daily_sales();

create trigger daily_sales_audit after insert or update or delete on public.daily_sales
  for each row execute function app.audit_row_change();

-- ---------------------------------------------------------------------
-- CSV 일괄 등록 (한 트랜잭션). SECURITY INVOKER → RLS·트리거 그대로 적용.
-- p_rows: [{store_id, business_date, net_sales, order_count, is_closed, memo}]
-- ---------------------------------------------------------------------
create or replace function public.import_daily_sales(p_file_name text, p_rows jsonb, p_overwrite boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch uuid;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_existing uuid;
  r record;
begin
  if coalesce(app.my_role() in ('owner', 'hq_manager', 'store_manager'), false) is false then
    raise exception '권한이 없습니다: 매출 일괄 등록은 관리자만 할 수 있습니다.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception '등록할 행이 없습니다.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception '한 번에 2000행까지만 등록할 수 있습니다.' using errcode = '22023';
  end if;

  insert into public.import_batches (file_name, row_count)
  values (left(p_file_name, 200), jsonb_array_length(p_rows))
  returning id into v_batch;

  for r in
    select *
    from jsonb_to_recordset(p_rows)
      as x(store_id uuid, business_date date, net_sales bigint, order_count integer, is_closed boolean, memo text)
  loop
    select id into v_existing
    from public.daily_sales
    where store_id = r.store_id and business_date = r.business_date;

    if v_existing is not null then
      if p_overwrite then
        update public.daily_sales
        set net_sales = r.net_sales,
            order_count = r.order_count,
            is_closed = coalesce(r.is_closed, false),
            memo = r.memo,
            source = 'csv',
            import_batch_id = v_batch
        where id = v_existing;
        v_updated := v_updated + 1;
      else
        v_skipped := v_skipped + 1;
      end if;
    else
      insert into public.daily_sales
        (store_id, business_date, net_sales, order_count, is_closed, memo, source, import_batch_id)
      values
        (r.store_id, r.business_date, r.net_sales, r.order_count, coalesce(r.is_closed, false), r.memo, 'csv', v_batch);
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  update public.import_batches
  set inserted = v_inserted, updated = v_updated, skipped = v_skipped
  where id = v_batch;

  return jsonb_build_object('batch_id', v_batch, 'inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped);
end;
$$;

-- =====================================================================
-- 권한 · RLS
-- =====================================================================
revoke all on public.daily_sales, public.import_batches from anon, authenticated;
grant select, insert, update, delete on public.daily_sales to authenticated;
grant select, insert, update on public.import_batches to authenticated;

revoke all on function public.import_daily_sales(text, jsonb, boolean) from public, anon;
grant execute on function public.import_daily_sales(text, jsonb, boolean) to authenticated;
grant execute on function app.seoul_today(), app.guard_daily_sales() to authenticated, service_role;

alter table public.daily_sales    enable row level security;
alter table public.import_batches enable row level security;

-- 매출 조회: 대표 / 소속 본사·지점 관리자 (직원 불가)
create policy daily_sales_select on public.daily_sales
  for select to authenticated
  using (app.can_view_store_financials(store_id));
create policy daily_sales_insert on public.daily_sales
  for insert to authenticated
  with check (app.can_manage_store(store_id));
create policy daily_sales_update on public.daily_sales
  for update to authenticated
  using (app.can_manage_store(store_id))
  with check (app.can_manage_store(store_id));
-- 삭제는 대표만 (감사로그에 남음)
create policy daily_sales_delete on public.daily_sales
  for delete to authenticated
  using (app.is_owner());

create policy import_batches_select on public.import_batches
  for select to authenticated
  using (created_by = auth.uid() or app.is_owner());
create policy import_batches_insert on public.import_batches
  for insert to authenticated
  with check (created_by = auth.uid() and app.my_role() in ('owner', 'hq_manager', 'store_manager'));
create policy import_batches_update on public.import_batches
  for update to authenticated
  using (created_by = auth.uid())
  with check (created_by = auth.uid());
