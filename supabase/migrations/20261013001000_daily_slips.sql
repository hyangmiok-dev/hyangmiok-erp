-- =====================================================================
-- 전표 입력: 아침에 거래명세표(전표)가 오면 거래처마다 '총금액'만 적는다
-- ---------------------------------------------------------------------
-- 대표 결정 (2026-10-13)
--  * 텔레그램·앱 발주·품목 체크는 쓰지 않는다 (0900 표·함수는 남아 있지만 메뉴에서 숨김). 품목 상세는 나중에 대표가 [지출 입력]에서
--  * 일일정산 앱처럼: 지점 거래처 목록 + 칸마다 금액. 거래처·날짜마다 금액 1개 → 다시 적으면 고쳐지고, 0(빈칸)이면 지워진다
--  * 저장하면 지출 1건(거래처 기본 항목, 보통 식재료비) → 외상 거래처면 거래처 미수에 쌓이고 원가율에 바로 반영
-- 권한: 그 지점 사람 모두(app.has_store_access, 직원 포함). 지출 표는 여전히 대표·본사 관리자만 본다
--       → 아래 SECURITY DEFINER 함수로만 읽고 쓴다. 미수 잔액은 이 함수들이 주지 않는다(화면에서 대표·본사만 따로 계산)
-- 날짜: 미래 불가, 대표 외에는 오늘부터 7일 전까지 (매출·입고 입력과 같음)
-- 품목 상세가 붙은 전표(대표가 지출 입력에서 줄을 넣은 것)는 금액이 어긋나지 않게 여기서 못 고친다
-- =====================================================================

alter table public.expenses add column is_slip boolean not null default false;

comment on column public.expenses.is_slip is
  'true = 전표 입력 화면에서 적은 거래처 하루 총금액 (지점·날짜·거래처마다 1건)';

create unique index expenses_slip_key on public.expenses (store_id, expense_date, vendor_id) where is_slip;

-- 1) 그 날 전표 칸: 지점과 거래하는 거래처(사용 중) + 그 날 이미 적힌 거래처
create or replace function public.slip_sheet(p_store_id uuid, p_date date)
returns table (
  vendor_id   uuid,
  vendor_name text,
  on_credit   boolean,
  amount      bigint,
  has_lines   boolean,
  entered_by  text,
  entered_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.has_store_access(p_store_id) then
    raise exception '이 지점의 전표를 볼 권한이 없습니다.' using errcode = '42501';
  end if;

  return query
  select v.id,
         v.name,
         coalesce(e.on_credit, v.on_credit),
         e.amount,
         coalesce((select true from public.expense_lines l where l.expense_id = e.id limit 1), false),
         p.full_name,
         e.updated_at
  from public.vendors v
  left join public.expenses e
    on e.store_id = p_store_id and e.expense_date = p_date and e.vendor_id = v.id and e.is_slip
  left join public.profiles p on p.id = coalesce(e.updated_by, e.created_by)
  where e.id is not null
     or (v.is_active
         and exists (select 1 from public.vendor_stores vs where vs.vendor_id = v.id and vs.store_id = p_store_id))
  order by v.sort_order, v.name;
end;
$$;

-- 2) 저장: [{vendor_id, amount}] — 바뀐 칸만 보낸다. 0 이면 그 날 그 거래처 전표를 지운다
create or replace function public.save_slips(p_store_id uuid, p_date date, p_entries jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_vendor public.vendors%rowtype;
  v_slip public.expenses%rowtype;
  v_changed integer := 0;
  v_bad integer;
begin
  if auth.uid() is null or not app.has_store_access(p_store_id) then
    raise exception '이 지점에 전표를 입력할 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_date is null or p_date > app.seoul_today() then
    raise exception '날짜를 확인하세요 (미래 날짜는 안 됩니다).' using errcode = '22023';
  end if;
  if not app.is_owner() and p_date < app.seoul_today() - 7 then
    raise exception '7일보다 지난 전표는 대표만 고칠 수 있습니다.' using errcode = '22023';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) not between 1 and 60 then
    raise exception '저장할 금액이 없습니다.' using errcode = '22023';
  end if;
  select count(*) into v_bad
  from jsonb_array_elements(p_entries) as x
  where case
    when jsonb_typeof(x) <> 'object' then true
    when coalesce(x ->> 'vendor_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then true
    when coalesce(x ->> 'amount', '') !~ '^[0-9]{1,10}$' then true
    when (x ->> 'amount')::bigint > 9999999999 then true
    else false
  end;
  if v_bad > 0 then
    raise exception '금액은 0원부터 99억 원까지 숫자로 적어 주세요.' using errcode = '22023';
  end if;
  if (select count(distinct (x ->> 'vendor_id')::uuid) from jsonb_array_elements(p_entries) as x)
     <> jsonb_array_length(p_entries) then
    raise exception '같은 거래처가 두 번 들어 있습니다.' using errcode = '22023';
  end if;

  for r in
    select (x ->> 'vendor_id')::uuid as vendor_id, (x ->> 'amount')::bigint as amount
    from jsonb_array_elements(p_entries) as x
  loop
    select * into v_slip
    from public.expenses e
    where e.store_id = p_store_id and e.expense_date = p_date and e.vendor_id = r.vendor_id and e.is_slip
    for update;

    if found then
      if r.amount = v_slip.amount then
        continue;
      end if;
      if exists (select 1 from public.expense_lines l where l.expense_id = v_slip.id) then
        raise exception '% 전표는 품목 상세가 들어가 있어 [지출 입력]에서만 고칠 수 있습니다.', coalesce(v_slip.vendor, '이')
          using errcode = '22023';
      end if;
      if r.amount = 0 then
        delete from public.expenses where id = v_slip.id;
      else
        update public.expenses set amount = r.amount where id = v_slip.id;
      end if;
      v_changed := v_changed + 1;
    elsif r.amount > 0 then
      select * into v_vendor
      from public.vendors v
      where v.id = r.vendor_id
        and v.is_active
        and exists (select 1 from public.vendor_stores vs where vs.vendor_id = v.id and vs.store_id = p_store_id);
      if not found then
        raise exception '이 지점과 거래하는 거래처가 아닙니다. 대표에게 거래처 관리에서 확인해 달라고 하세요.'
          using errcode = '22023';
      end if;
      insert into public.expenses
        (store_id, expense_date, category_id, vendor, vendor_id, description, amount, basis, on_credit, is_slip)
      values (
        p_store_id,
        p_date,
        coalesce(v_vendor.default_category_id, (select c.id from public.expense_categories c where c.code = 'food')),
        left(v_vendor.name, 60),
        v_vendor.id,
        '전표 총금액',
        r.amount,
        'actual',
        v_vendor.on_credit,
        true
      )
      -- 두 사람이 같은 칸을 동시에 처음 저장하면 나중 것으로
      on conflict (store_id, expense_date, vendor_id) where is_slip do update set amount = excluded.amount;
      v_changed := v_changed + 1;
    end if;
  end loop;

  return v_changed;
end;
$$;

-- 3) 최근 2주 날짜별 전표 합계 (지난 기록)
create or replace function public.slip_days(p_store_id uuid)
returns table (
  slip_date date,
  total     bigint,
  vendors   integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.has_store_access(p_store_id) then
    raise exception '이 지점의 전표를 볼 권한이 없습니다.' using errcode = '42501';
  end if;

  return query
  select e.expense_date, sum(e.amount)::bigint, count(*)::integer
  from public.expenses e
  where e.store_id = p_store_id
    and e.is_slip
    and e.expense_date >= app.seoul_today() - 13
  group by e.expense_date
  order by e.expense_date desc;
end;
$$;

revoke all on function public.slip_sheet(uuid, date) from public, anon;
revoke all on function public.save_slips(uuid, date, jsonb) from public, anon;
revoke all on function public.slip_days(uuid) from public, anon;
grant execute on function public.slip_sheet(uuid, date) to authenticated;
grant execute on function public.save_slips(uuid, date, jsonb) to authenticated;
grant execute on function public.slip_days(uuid) to authenticated;
