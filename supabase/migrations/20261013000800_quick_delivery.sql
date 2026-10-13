-- =====================================================================
-- 입고 빠른 입력 (거래명세표 사진 AI 대신)
-- ---------------------------------------------------------------------
-- 대표 결정 (2026-10-13)
--  * 사진 AI 읽기는 오류·지연이 많아 쓰지 않는다 (0700 의 표·보관함·함수는 남아 있으나 앱에서 쓰지 않음)
--  * 아침에 물건을 받고 확인하면서 바로 적을 수 있게: 거래처 → 지난번 품목·단가 자동 → 수량만 누르기 → 저장
--  * 점장(지점 관리자)도 입력. 지출 표는 여전히 대표·본사 관리자만 본다 → 아래 SECURITY DEFINER 함수로만 입력
-- 권한: app.can_manage_store (대표, 소속 본사·지점 관리자). 직원 불가.
--       지점 관리자 날짜 제한: 오늘부터 7일 전까지 (매출 입력과 같음). 대표는 제한 없음(미래만 금지)
--       취소: 본인이 오늘 입력한 것만 (대표는 언제든)
-- =====================================================================

-- 1) 지점·거래처별로 전에 받은 품목 (최근 1년): 마지막 단가·수량, 받은 횟수, 바로 지난번 입고에 있었는지
create or replace function public.delivery_items(p_store_id uuid)
returns table (
  vendor_id   uuid,
  item_name   text,
  unit        text,
  last_price  bigint,
  last_qty    numeric,
  last_date   date,
  times       integer,
  in_last     boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.can_manage_store(p_store_id) then
    raise exception '이 지점의 입고를 볼 권한이 없습니다.' using errcode = '42501';
  end if;

  return query
  with lines as (
    select e.vendor_id,
           e.id as expense_id,
           e.expense_date,
           e.created_at,
           btrim(l.item_name) as item_name,
           nullif(btrim(coalesce(l.unit, '')), '') as unit,
           l.unit_price,
           l.quantity,
           l.line_no
    from public.expenses e
    join public.expense_lines l on l.expense_id = e.id
    where e.store_id = p_store_id
      and e.vendor_id is not null
      and e.expense_date >= app.seoul_today() - 365
      and btrim(l.item_name) <> '부가세'
  ),
  last_expense as (
    select distinct on (x.vendor_id) x.vendor_id, x.expense_id
    from lines x
    order by x.vendor_id, x.expense_date desc, x.created_at desc
  ),
  latest as (
    select distinct on (x.vendor_id, x.item_name, coalesce(x.unit, ''))
           x.vendor_id, x.item_name, x.unit, x.unit_price, x.quantity, x.expense_date
    from lines x
    order by x.vendor_id, x.item_name, coalesce(x.unit, ''), x.expense_date desc, x.created_at desc, x.line_no
  ),
  counts as (
    select x.vendor_id, x.item_name, coalesce(x.unit, '') as unit_key, count(distinct x.expense_id)::integer as n,
           bool_or(x.expense_id = le.expense_id) as in_last
    from lines x
    join last_expense le on le.vendor_id = x.vendor_id
    group by x.vendor_id, x.item_name, coalesce(x.unit, '')
  )
  select t.vendor_id, t.item_name, t.unit, t.unit_price, t.quantity, t.expense_date, c.n, c.in_last
  from latest t
  join counts c on c.vendor_id = t.vendor_id and c.item_name = t.item_name and c.unit_key = coalesce(t.unit, '')
  order by t.vendor_id, c.in_last desc, c.n desc, t.expense_date desc, t.item_name;
end;
$$;

-- 2) 입고 저장: 식재료 지출 + 품목 줄 (+ 부가세 줄). 금액은 수량×단가로 DB 가 다시 계산한다
create or replace function public.record_delivery(
  p_store_id uuid,
  p_vendor_id uuid,
  p_date date,
  p_lines jsonb,
  p_vat bigint,
  p_on_credit boolean,
  p_memo text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vendor public.vendors%rowtype;
  v_category uuid;
  v_count integer;
  v_bad integer;
  v_total bigint;
  v_expense uuid;
  v_vat bigint := coalesce(p_vat, 0);
begin
  if auth.uid() is null or not app.can_manage_store(p_store_id) then
    raise exception '이 지점에 입고를 입력할 권한이 없습니다.' using errcode = '42501';
  end if;
  select * into v_vendor from public.vendors where id = p_vendor_id and is_active;
  if not found then
    raise exception '거래 중인 거래처가 아닙니다.' using errcode = '22023';
  end if;
  if p_date is null or p_date > app.seoul_today() then
    raise exception '날짜를 확인하세요 (미래 날짜는 안 됩니다).' using errcode = '22023';
  end if;
  if not app.is_owner() and p_date < app.seoul_today() - 7 then
    raise exception '7일보다 지난 입고는 대표만 입력할 수 있습니다.' using errcode = '22023';
  end if;
  if v_vat < 0 or v_vat > 999999999 then
    raise exception '부가세 금액을 확인하세요.' using errcode = '22023';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception '품목 형식이 올바르지 않습니다.' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_lines);
  if v_count < 1 or v_count > 49 then
    raise exception '품목은 1~49줄이어야 합니다.' using errcode = '22023';
  end if;
  select count(*) into v_bad
  from jsonb_array_elements(p_lines) as l
  where case
    when jsonb_typeof(l) <> 'object' then true
    when char_length(btrim(coalesce(l ->> 'item_name', ''))) not between 1 and 60 then true
    when btrim(l ->> 'item_name') = '부가세' then true
    when coalesce(l ->> 'quantity', '') !~ '^[0-9]{1,9}([.][0-9]{1,3})?$' then true
    when (l ->> 'quantity')::numeric <= 0 then true
    when char_length(coalesce(l ->> 'unit', '')) > 10 then true
    when coalesce(l ->> 'unit_price', '') !~ '^[0-9]{1,9}$' then true
    else false
  end;
  if v_bad > 0 then
    raise exception '품목 줄 %개가 비었거나 숫자가 올바르지 않습니다.', v_bad using errcode = '22023';
  end if;

  select sum(round((l ->> 'quantity')::numeric * (l ->> 'unit_price')::bigint)::bigint) + v_vat
  into v_total
  from jsonb_array_elements(p_lines) as l;
  if v_total < 1 or v_total > 9999999999 then
    raise exception '합계 금액을 확인하세요.' using errcode = '22023';
  end if;

  v_category := coalesce(
    v_vendor.default_category_id,
    (select c.id from public.expense_categories c where c.code = 'food')
  );

  insert into public.expenses (store_id, expense_date, category_id, vendor, vendor_id, description, amount, basis, on_credit)
  values (
    p_store_id,
    p_date,
    v_category,
    left(v_vendor.name, 60),
    v_vendor.id,
    left(concat_ws(' · ', '입고 입력', nullif(btrim(coalesce(p_memo, '')), '')), 200),
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
         round((t.l ->> 'quantity')::numeric * (t.l ->> 'unit_price')::bigint)::bigint
  from jsonb_array_elements(p_lines) with ordinality as t(l, ord);

  if v_vat > 0 then
    insert into public.expense_lines (expense_id, line_no, item_name, quantity, unit, unit_price, amount)
    values (v_expense, v_count + 1, '부가세', 1, null, v_vat, v_vat);
  end if;

  return v_expense;
end;
$$;

-- 3) 최근 3일 입고 (지점 화면 아래 목록). 취소 가능 여부 포함
create or replace function public.recent_deliveries(p_store_id uuid)
returns table (
  id              uuid,
  expense_date    date,
  vendor_name     text,
  amount          bigint,
  item_count      integer,
  first_item      text,
  on_credit       boolean,
  created_by_name text,
  created_at      timestamptz,
  can_cancel      boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.can_manage_store(p_store_id) then
    raise exception '이 지점의 입고를 볼 권한이 없습니다.' using errcode = '42501';
  end if;

  return query
  select e.id,
         e.expense_date,
         coalesce(v.name, e.vendor),
         e.amount,
         (select count(*)::integer from public.expense_lines l where l.expense_id = e.id and l.item_name <> '부가세'),
         (select l.item_name from public.expense_lines l where l.expense_id = e.id order by l.line_no limit 1),
         e.on_credit,
         p.full_name,
         e.created_at,
         (app.is_owner()
           or (e.created_by = auth.uid()
               and e.created_at >= (app.seoul_today()::timestamp at time zone 'Asia/Seoul')))
  from public.expenses e
  join public.expense_categories c on c.id = e.category_id and c.section = 'cogs'
  left join public.vendors v on v.id = e.vendor_id
  left join public.profiles p on p.id = e.created_by
  where e.store_id = p_store_id
    and e.vendor_id is not null
    and e.expense_date >= app.seoul_today() - 2
  order by e.expense_date desc, e.created_at desc
  limit 50;
end;
$$;

-- 4) 입고 취소: 본인이 오늘 입력한 것만 (대표는 언제든). 변경 이력에 삭제로 남는다
create or replace function public.cancel_delivery(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.expenses%rowtype;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  select * into e from public.expenses where id = p_expense_id for update;
  if not found or not app.can_manage_store(e.store_id) or e.vendor_id is null then
    raise exception '입고 기록을 찾을 수 없거나 권한이 없습니다.' using errcode = '42501';
  end if;
  if not app.is_owner()
     and not (e.created_by = auth.uid() and e.created_at >= (app.seoul_today()::timestamp at time zone 'Asia/Seoul')) then
    raise exception '본인이 오늘 입력한 입고만 취소할 수 있습니다. 대표에게 요청하세요.' using errcode = '42501';
  end if;
  delete from public.expenses where id = e.id;
end;
$$;

revoke all on function public.delivery_items(uuid) from public, anon;
revoke all on function public.record_delivery(uuid, uuid, date, jsonb, bigint, boolean, text) from public, anon;
revoke all on function public.recent_deliveries(uuid) from public, anon;
revoke all on function public.cancel_delivery(uuid) from public, anon;
grant execute on function public.delivery_items(uuid) to authenticated;
grant execute on function public.record_delivery(uuid, uuid, date, jsonb, bigint, boolean, text) to authenticated;
grant execute on function public.recent_deliveries(uuid) to authenticated;
grant execute on function public.cancel_delivery(uuid) to authenticated;
