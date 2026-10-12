-- =====================================================================
-- 3단계: 지출 · 월말 재고 · 손익
-- ---------------------------------------------------------------------
-- 대표 결정 (2026-10-13)
--  * 지출은 대표만 입력 (본사 관리자는 소속 지점 조회만, 지점 관리자·직원은 볼 수 없음)
--  * 재료 매입은 거래명세표 단위로 들어올 때마다 입력
--  * 월말 재고는 가끔만 셈 → 재고가 있는 달은 '기초+매입-기말' 실제 원가,
--    없는 달은 '매입액 = 원가'로 보고 '추정'으로 표시
-- 금액 기준: 모든 금액은 부가세 포함 (POS 실매출도 부가세 포함이므로 기준 일치)
-- 손익 구분(section)
--  * cogs   : 식재료 매출원가 (원가율)
--  * labor  : 인건비 (인건비율)
--  * opex   : 기타 영업비용
--  * excluded: 영업이익 계산 제외 (부가세·법인세 등 세금, 대출이자, 보증금·권리금 등 자산성 지출)
-- =====================================================================

create table public.expense_categories (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[a-z_]{2,30}$'),
  name        text not null check (char_length(btrim(name)) between 1 and 30),
  section     text not null check (section in ('cogs', 'labor', 'opex', 'excluded')),
  description text check (description is null or char_length(description) <= 200),
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.expense_categories is '지출 항목. section 이 손익계산에서의 위치를 결정한다.';

insert into public.expense_categories (code, name, section, description, sort_order) values
  ('food',         '식재료비',     'cogs',     '고기·면·채소·소스 등 원재료 매입 (거래명세표 단위)', 10),
  ('labor_wage',   '급여',         'labor',    '직원 급여·아르바이트 (세전 지급액)', 20),
  ('labor_ins',    '4대보험',      'labor',    '사업주 부담 국민연금·건강·고용·산재', 21),
  ('labor_etc',    '기타 인건비',  'labor',    '퇴직금·상여·외국인 급여 수수료 등', 22),
  ('rent',         '임대료',       'opex',     '월세', 30),
  ('maintenance',  '관리비',       'opex',     '건물 관리비', 31),
  ('utilities',    '수도광열비',   'opex',     '전기·가스·수도', 32),
  ('advertising',  '광고비',       'opex',     '네이버·인스타·리뷰·마케팅 대행', 33),
  ('card_fee',     '카드수수료',   'opex',     '카드사 수수료·단말기 요금', 34),
  ('delivery_fee', '배달 수수료',  'opex',     '배달앱·배달대행 수수료', 35),
  ('supplies',     '소모품비',     'opex',     '일회용품·비품·주방용품·세제', 36),
  ('repairs',      '수선비',       'opex',     '설비·기계 수리', 37),
  ('services',     '용역·수수료',  'opex',     '세무·노무·세스코·보안·통신', 38),
  ('other',        '기타 영업비용','opex',     '식대·복리후생·교통비 등', 39),
  ('depreciation', '감가상각비',   'opex',     '인테리어·설비 감가상각 (월 금액)', 40),
  ('tax',          '세금',         'excluded', '부가세·법인세·원천세 등 (영업이익 계산 제외)', 90),
  ('finance',      '금융비용',     'excluded', '대출이자·할부 (영업이익 계산 제외)', 91),
  ('capital',      '보증금·투자',  'excluded', '보증금·권리금·큰 설비 구입 (비용 아님, 제외)', 92);

create table public.expenses (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores (id) on delete restrict,
  expense_date  date not null,
  category_id   uuid not null references public.expense_categories (id) on delete restrict,
  vendor        text check (vendor is null or char_length(vendor) <= 60),
  description   text check (description is null or char_length(description) <= 200),
  amount        bigint not null check (amount between 1 and 9999999999),
  basis         text not null default 'actual' check (basis in ('actual', 'estimated')),
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles (id) on delete set null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null
);

create index expenses_store_date_idx on public.expenses (store_id, expense_date);

comment on column public.expenses.basis is 'actual=영수증·명세서 확인 금액, estimated=추정(지난달 복사 등). 추정은 손익에 추정으로 표시';

-- 월말(또는 임의 시점) 재고 금액 실사
create table public.inventory_counts (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references public.stores (id) on delete restrict,
  count_date  date not null,
  amount      bigint not null check (amount between 0 and 9999999999),
  memo        text check (memo is null or char_length(memo) <= 200),
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null,
  constraint inventory_counts_store_date_key unique (store_id, count_date)
);

-- 입력자 기록 공통 트리거
create or replace function app.stamp_actor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if new.store_id is distinct from old.store_id then
      raise exception '지점은 바꿀 수 없습니다. 삭제 후 다시 입력하세요.' using errcode = '22023';
    end if;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

-- 미래 날짜 지출 금지 (선결제 월세 등은 해당 월 1일로 입력)
create or replace function app.guard_expense_date()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.expense_date > app.seoul_today() then
    raise exception '미래 날짜(%)의 지출은 입력할 수 없습니다.', new.expense_date using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function app.guard_count_date()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.count_date > app.seoul_today() then
    raise exception '미래 날짜(%)의 재고는 입력할 수 없습니다.', new.count_date using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger expenses_stamp before insert or update on public.expenses
  for each row execute function app.stamp_actor();
create trigger expenses_date before insert or update on public.expenses
  for each row execute function app.guard_expense_date();
create trigger expenses_audit after insert or update or delete on public.expenses
  for each row execute function app.audit_row_change();

create trigger inventory_counts_stamp before insert or update on public.inventory_counts
  for each row execute function app.stamp_actor();
create trigger inventory_counts_date before insert or update on public.inventory_counts
  for each row execute function app.guard_count_date();
create trigger inventory_counts_audit after insert or update or delete on public.inventory_counts
  for each row execute function app.audit_row_change();
create trigger expense_categories_audit after insert or update or delete on public.expense_categories
  for each row execute function app.audit_row_change();

-- 지출·손익 조회 권한: 대표 전체, 본사 관리자는 소속 지점. 지점 관리자·직원 불가.
create or replace function app.can_view_store_pnl(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app.my_role() = 'owner' then true
    when app.my_role() = 'hq_manager' then app.has_store_access(p_store_id)
    else false
  end
$$;

-- =====================================================================
-- 권한 · RLS
-- =====================================================================
revoke all on public.expense_categories, public.expenses, public.inventory_counts from anon, authenticated;
grant select, insert, update on public.expense_categories to authenticated;
grant select, insert, update, delete on public.expenses, public.inventory_counts to authenticated;
grant execute on function app.can_view_store_pnl(uuid), app.stamp_actor(), app.guard_expense_date(), app.guard_count_date()
  to authenticated, service_role;

alter table public.expense_categories enable row level security;
alter table public.expenses           enable row level security;
alter table public.inventory_counts   enable row level security;

create policy expense_categories_select on public.expense_categories
  for select to authenticated
  using (app.my_role() in ('owner', 'hq_manager'));
create policy expense_categories_insert on public.expense_categories
  for insert to authenticated with check (app.is_owner());
create policy expense_categories_update on public.expense_categories
  for update to authenticated using (app.is_owner()) with check (app.is_owner());

create policy expenses_select on public.expenses
  for select to authenticated using (app.can_view_store_pnl(store_id));
create policy expenses_insert on public.expenses
  for insert to authenticated with check (app.is_owner());
create policy expenses_update on public.expenses
  for update to authenticated using (app.is_owner()) with check (app.is_owner());
create policy expenses_delete on public.expenses
  for delete to authenticated using (app.is_owner());

create policy inventory_counts_select on public.inventory_counts
  for select to authenticated using (app.can_view_store_pnl(store_id));
create policy inventory_counts_insert on public.inventory_counts
  for insert to authenticated with check (app.is_owner());
create policy inventory_counts_update on public.inventory_counts
  for update to authenticated using (app.is_owner()) with check (app.is_owner());
create policy inventory_counts_delete on public.inventory_counts
  for delete to authenticated using (app.is_owner());
