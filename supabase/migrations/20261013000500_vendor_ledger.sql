-- =====================================================================
-- 거래처 원장: 거래명세표 품목·단가 + 미수(외상) 관리 + 3호점 거래처 연결
-- ---------------------------------------------------------------------
-- 대표 요청 (2026-10-13)
--  * 3호점도 1·2호점과 거래처가 같다 → 18곳 모두 3호점에 연결
--  * 거래처마다 날짜별로 품목·가격(거래명세표)을 적고, 미수도 같이 계산되게
-- 미수 잔액 = 이월 미수 + 외상 매입(지출 중 on_credit) − 결제
-- 권한: 지출과 같다 — 대표만 입력, 본사 관리자는 소속 지점 조회, 지점 관리자·직원 불가
-- =====================================================================

-- 1) 3호점 거래처 연결
insert into public.vendor_stores (vendor_id, store_id)
select v.id, s.id
from public.vendors v
cross join public.stores s
where s.code = 'S3'
on conflict (vendor_id, store_id) do nothing;

-- 2) 외상 거래 여부
alter table public.vendors
  add column on_credit boolean not null default true;
comment on column public.vendors.on_credit is
  '외상(나중에 결제) 거래처면 true. 지출 입력 시 미수로 잡기 기본값. 카드로 바로 결제하는 곳은 false';

alter table public.expenses
  add column on_credit boolean not null default false;
comment on column public.expenses.on_credit is
  'true = 외상 매입(아직 결제 안 함) → 거래처 미수 잔액에 더해진다. 결제는 vendor_payments 에 기록';

-- 거래 기록(원장)이 있는 거래처는 삭제할 수 없게 (삭제 대신 '거래 중' 해제)
alter table public.expenses drop constraint if exists expenses_vendor_id_fkey;
alter table public.expenses
  add constraint expenses_vendor_id_fkey foreign key (vendor_id) references public.vendors (id) on delete restrict;

-- 3) 거래명세표 품목 줄
create table public.expense_lines (
  id          uuid primary key default gen_random_uuid(),
  expense_id  uuid not null references public.expenses (id) on delete cascade,
  line_no     smallint not null check (line_no between 1 and 50),
  item_name   text not null check (char_length(btrim(item_name)) between 1 and 60),
  quantity    numeric(12, 3) not null check (quantity > 0),
  unit        text check (unit is null or char_length(unit) <= 10),
  unit_price  bigint not null check (unit_price between 0 and 999999999),
  amount      bigint not null check (amount between 0 and 9999999999),
  constraint expense_lines_no_key unique (expense_id, line_no)
);

create index expense_lines_expense_idx on public.expense_lines (expense_id);
create index expense_lines_item_idx on public.expense_lines (item_name);

comment on table public.expense_lines is '지출(주로 식재료 매입)의 품목 내역. 금액은 부가세 포함. 줄이 있으면 줄 금액 합계 = 지출 금액';

-- 4) 결제·이월 미수
create table public.vendor_payments (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores (id) on delete restrict,
  vendor_id   uuid not null references public.vendors (id) on delete restrict,
  paid_date   date not null,
  kind        text not null default 'payment' check (kind in ('payment', 'opening')),
  amount      bigint not null check (amount between 1 and 9999999999),
  method      text check (method is null or method in ('transfer', 'card', 'cash', 'other')),
  memo        text check (memo is null or char_length(memo) <= 200),
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

create index vendor_payments_store_vendor_idx on public.vendor_payments (store_id, vendor_id, paid_date);

comment on column public.vendor_payments.kind is
  'payment = 결제(미수 감소), opening = 이월 미수(이 프로그램을 쓰기 전부터 있던 미수, 미수 증가)';

create or replace function app.guard_paid_date()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.paid_date > app.seoul_today() then
    raise exception '미래 날짜(%)는 입력할 수 없습니다.', new.paid_date using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger vendor_payments_stamp before insert or update on public.vendor_payments
  for each row execute function app.stamp_actor();
create trigger vendor_payments_date before insert or update on public.vendor_payments
  for each row execute function app.guard_paid_date();
create trigger vendor_payments_audit after insert or update or delete on public.vendor_payments
  for each row execute function app.audit_row_change();

-- 5) 지출 + 품목 줄을 한 번에 저장 (부분 저장 방지, 합계 검증)
-- SECURITY INVOKER: expenses / expense_lines 의 RLS(대표만)와 트리거가 그대로 적용된다.
create or replace function public.save_expense_with_lines(
  p_expense jsonb,
  p_lines jsonb,
  p_expected_updated_at timestamptz default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_expense ->> 'id', '')::uuid;
  v_amount bigint := (p_expense ->> 'amount')::bigint;
  v_lines jsonb := coalesce(p_lines, '[]'::jsonb);
  v_count integer;
  v_total bigint;
begin
  if not app.is_owner() then
    raise exception '권한이 없습니다: 지출은 대표만 입력할 수 있습니다.' using errcode = '42501';
  end if;
  if jsonb_typeof(v_lines) <> 'array' then
    raise exception '품목 형식이 올바르지 않습니다.' using errcode = '22023';
  end if;

  v_count := jsonb_array_length(v_lines);
  if v_count > 50 then
    raise exception '품목은 50줄까지 입력할 수 있습니다.' using errcode = '22023';
  end if;
  select coalesce(sum((l ->> 'amount')::bigint), 0) into v_total from jsonb_array_elements(v_lines) as l;
  if v_count > 0 and v_total <> v_amount then
    raise exception '품목 금액 합계(%)와 지출 금액(%)이 다릅니다.', v_total, v_amount using errcode = '22023';
  end if;
  if coalesce((p_expense ->> 'on_credit')::boolean, false) and nullif(p_expense ->> 'vendor_id', '') is null then
    raise exception '외상(미수)은 거래처를 골라야 기록할 수 있습니다.' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.expenses
      (store_id, expense_date, category_id, vendor, vendor_id, description, amount, basis, on_credit)
    values (
      (p_expense ->> 'store_id')::uuid,
      (p_expense ->> 'expense_date')::date,
      (p_expense ->> 'category_id')::uuid,
      nullif(p_expense ->> 'vendor', ''),
      nullif(p_expense ->> 'vendor_id', '')::uuid,
      nullif(p_expense ->> 'description', ''),
      v_amount,
      coalesce(p_expense ->> 'basis', 'actual'),
      coalesce((p_expense ->> 'on_credit')::boolean, false)
    )
    returning id into v_id;
  else
    update public.expenses
    set expense_date = (p_expense ->> 'expense_date')::date,
        category_id = (p_expense ->> 'category_id')::uuid,
        vendor = nullif(p_expense ->> 'vendor', ''),
        vendor_id = nullif(p_expense ->> 'vendor_id', '')::uuid,
        description = nullif(p_expense ->> 'description', ''),
        amount = v_amount,
        basis = coalesce(p_expense ->> 'basis', 'actual'),
        on_credit = coalesce((p_expense ->> 'on_credit')::boolean, false)
    where id = v_id
      and (p_expected_updated_at is null or updated_at = p_expected_updated_at)
    returning id into v_id;
    if v_id is null then
      raise exception '다른 화면에서 이 지출이 먼저 수정되었거나 찾을 수 없습니다.' using errcode = '40001';
    end if;
    delete from public.expense_lines where expense_id = v_id;
  end if;

  insert into public.expense_lines (expense_id, line_no, item_name, quantity, unit, unit_price, amount)
  select v_id,
         t.ord,
         btrim(t.l ->> 'item_name'),
         (t.l ->> 'quantity')::numeric,
         nullif(btrim(coalesce(t.l ->> 'unit', '')), ''),
         (t.l ->> 'unit_price')::bigint,
         (t.l ->> 'amount')::bigint
  from jsonb_array_elements(v_lines) with ordinality as t(l, ord);

  return v_id;
end;
$$;

-- =====================================================================
-- 권한 · RLS
-- =====================================================================
revoke all on public.expense_lines, public.vendor_payments from anon, authenticated;
grant select, insert, update, delete on public.expense_lines, public.vendor_payments to authenticated;
revoke all on function public.save_expense_with_lines(jsonb, jsonb, timestamptz) from public, anon;
grant execute on function public.save_expense_with_lines(jsonb, jsonb, timestamptz) to authenticated;
grant execute on function app.guard_paid_date() to authenticated, service_role;

alter table public.expense_lines   enable row level security;
alter table public.vendor_payments enable row level security;

create policy expense_lines_select on public.expense_lines
  for select to authenticated
  using (exists (
    select 1 from public.expenses e
    where e.id = expense_id and app.can_view_store_pnl(e.store_id)
  ));
create policy expense_lines_insert on public.expense_lines
  for insert to authenticated with check (app.is_owner());
create policy expense_lines_update on public.expense_lines
  for update to authenticated using (app.is_owner()) with check (app.is_owner());
create policy expense_lines_delete on public.expense_lines
  for delete to authenticated using (app.is_owner());

create policy vendor_payments_select on public.vendor_payments
  for select to authenticated using (app.can_view_store_pnl(store_id));
create policy vendor_payments_insert on public.vendor_payments
  for insert to authenticated with check (app.is_owner());
create policy vendor_payments_update on public.vendor_payments
  for update to authenticated using (app.is_owner()) with check (app.is_owner());
create policy vendor_payments_delete on public.vendor_payments
  for delete to authenticated using (app.is_owner());
