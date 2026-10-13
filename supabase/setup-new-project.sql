-- =====================================================================
-- 향미옥 경영관리 — 새 Supabase 프로젝트 초기 설정 (자동 생성 파일, 직접 수정 금지)
-- 만든 방법: node scripts/build-setup-sql.mjs
-- 사용법: 새 프로젝트의 SQL Editor 에 전체를 붙여넣고 Run 한 번.
--         이미 설정된 프로젝트에 다시 실행하면 'already exists' 오류가 나며 아무것도 바뀌지 않습니다.
-- 포함: 20261012000100_stage1_core_auth.sql, 20261013000100_stage1b_name_login_first_password.sql, 20261013000200_stage2_daily_sales.sql, 20261013000300_stage3_expenses.sql, 20261013000400_vendors.sql, 20261013000500_vendor_ledger.sql, 20261013000600_stock_reserve.sql, 20261013000700_purchase_statements.sql, 20261013000800_quick_delivery.sql
-- =====================================================================

-- >>>>> 20261012000100_stage1_core_auth.sql
-- =====================================================================
-- 향미옥 경영관리 시스템 — 1단계: 지점 / 사용자 / 권한 / 감사로그
-- ---------------------------------------------------------------------
-- 원칙
--  * 모든 지점 데이터는 store_id 로 구분하고, 권한은 RLS 로 DB 에서 강제한다.
--  * 권한 판단 함수는 API 로 노출되지 않는 private 스키마 `app` 에 둔다.
--  * 클라이언트(anon) 는 어떤 테이블에도 접근할 수 없다.
--  * 확인되지 않은 지점 정보(주소·좌석수 등)는 NULL 로 둔다. 임의값 금지.
-- =====================================================================

create schema if not exists app;

-- ---------------------------------------------------------------------
-- 역할
-- ---------------------------------------------------------------------
create type public.app_role as enum ('owner', 'hq_manager', 'store_manager', 'staff');

comment on type public.app_role is
  'owner=최고관리자(대표), hq_manager=본사 관리자, store_manager=지점 관리자, staff=일반 직원';

-- ---------------------------------------------------------------------
-- 공통: updated_at 자동 갱신
-- ---------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 지점
-- ---------------------------------------------------------------------
create table public.stores (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name             text not null check (char_length(btrim(name)) between 1 and 50),
  address          text check (address is null or char_length(address) <= 200),
  seat_count       integer check (seat_count is null or seat_count between 0 and 1000),
  area_pyeong      numeric(6, 1) check (area_pyeong is null or area_pyeong > 0),
  -- 운영시간: 요일별 구조 데이터. 형식은 앱(zod)에서 검증. 미확인 시 NULL.
  business_hours   jsonb,
  notes            text check (notes is null or char_length(notes) <= 1000),
  sort_order       integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.stores is '직영 지점. 주소/좌석수/면적/운영시간은 확인된 값만 입력(NULL=미확인).';

create trigger stores_touch before update on public.stores
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- 사용자 프로필 (auth.users 1:1)
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null check (char_length(btrim(full_name)) between 1 and 50),
  -- 이메일이 없는 직원용 로그인 아이디(소문자/숫자/._-). 이메일 로그인 사용자는 NULL 가능.
  login_id    text unique check (login_id is null or login_id ~ '^[a-z0-9._-]{3,30}$'),
  -- Auth 이메일 사본(표시용). 아이디 로그인 사용자는 내부 가상 이메일이 들어간다.
  email       text,
  role        public.app_role not null default 'staff',
  -- 신규 계정은 비활성(승인 대기)으로 시작한다. 대표가 활성화해야 로그인 후 데이터 접근 가능.
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is '로그인 사용자. 인사/급여 정보는 별도 employees 테이블(4단계)에 둔다.';

create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------
-- 지점 소속 (본사관리자/지점관리자/직원이 접근 가능한 지점)
-- ---------------------------------------------------------------------
create table public.store_members (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  store_id    uuid not null references public.stores (id) on delete restrict,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null,
  primary key (user_id, store_id)
);

create index store_members_store_idx on public.store_members (store_id);

-- ---------------------------------------------------------------------
-- 감사 로그 (트리거만 기록, 수정/삭제 불가)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  actor_id     uuid,            -- auth.uid(); 서버 관리 작업(시크릿 키)이면 NULL
  actor_role   text,            -- DB 세션 역할 (authenticated / service_role 등)
  action       text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_name   text not null,
  record_id    text,
  store_id     uuid,
  old_data     jsonb,
  new_data     jsonb
);

create index audit_logs_occurred_idx on public.audit_logs (occurred_at desc);
create index audit_logs_table_record_idx on public.audit_logs (table_name, record_id);
create index audit_logs_store_idx on public.audit_logs (store_id, occurred_at desc);

-- =====================================================================
-- 권한 판단 함수 (SECURITY DEFINER: RLS 재귀 방지, search_path 고정)
-- =====================================================================

-- 현재 로그인 사용자의 역할. 비활성 사용자는 NULL → 모든 정책에서 거부.
create or replace function app.my_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active
$$;

create or replace function app.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(app.my_role() = 'owner', false)
$$;

-- 지점 데이터 조회 가능 여부: 대표는 전체, 그 외는 소속 지점만.
create or replace function app.has_store_access(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app.my_role() is null then false
    when app.my_role() = 'owner' then true
    else exists (
      select 1
      from public.store_members m
      where m.user_id = auth.uid()
        and m.store_id = p_store_id
    )
  end
$$;

-- 지점 운영 데이터 관리(입력/수정) 가능 여부: 대표, 또는 소속된 본사/지점 관리자.
create or replace function app.can_manage_store(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app.my_role() = 'owner' then true
    when app.my_role() in ('hq_manager', 'store_manager') then app.has_store_access(p_store_id)
    else false
  end
$$;

-- 지점 재무(매출·손익·인건비 합계) 조회 가능 여부: 직원은 불가.
create or replace function app.can_view_store_financials(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.can_manage_store(p_store_id)
$$;

-- 두 사용자가 같은 지점에 소속되어 있는지 (관리자가 소속 직원 이름을 보기 위함)
create or replace function app.shares_store_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.store_members mine
    join public.store_members theirs on theirs.store_id = mine.store_id
    where mine.user_id = auth.uid()
      and theirs.user_id = p_user_id
  )
$$;

-- =====================================================================
-- 무결성 트리거
-- =====================================================================

-- 프로필의 권한 관련 컬럼(role, is_active, login_id)은 대표 또는 서버(시크릿 키)만 변경 가능.
-- 마지막 활성 대표는 강등/비활성화할 수 없다.
-- SECURITY INVOKER 여야 current_user 가 호출자(authenticated/service_role)를 가리킨다.
create or replace function app.guard_profile_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_is_privileged boolean :=
    current_user in ('postgres', 'service_role', 'supabase_admin') or app.is_owner();
begin
  if (new.role is distinct from old.role
      or new.is_active is distinct from old.is_active
      or new.login_id is distinct from old.login_id
      or new.id is distinct from old.id)
     and not v_is_privileged then
    raise exception '권한이 없습니다: 역할/활성상태/아이디는 대표만 변경할 수 있습니다.'
      using errcode = '42501';
  end if;

  if old.role = 'owner' and old.is_active
     and (new.role <> 'owner' or not new.is_active)
     and not exists (
       select 1 from public.profiles
       where role = 'owner' and is_active and id <> old.id
     ) then
    raise exception '마지막 대표 계정은 강등하거나 비활성화할 수 없습니다.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger profiles_guard before update on public.profiles
  for each row execute function app.guard_profile_update();

-- auth.users 생성 시 프로필 자동 생성.
-- 보안: user_metadata 의 role 은 절대 신뢰하지 않는다. 항상 staff / 비활성으로 시작.
create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, role, is_active)
  values (
    new.id,
    left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1), '이름없음'), 50),
    new.email,
    'staff',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- 사용자의 소속 지점을 한 트랜잭션으로 교체한다 (부분 반영 방지).
-- SECURITY INVOKER: store_members 의 RLS(대표만 변경)가 그대로 적용된다.
create or replace function public.set_store_memberships(p_user_id uuid, p_store_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not app.is_owner() then
    raise exception '권한이 없습니다: 소속 지점은 대표만 변경할 수 있습니다.' using errcode = '42501';
  end if;

  delete from public.store_members
  where user_id = p_user_id
    and store_id <> all (coalesce(p_store_ids, '{}'));

  insert into public.store_members (user_id, store_id, created_by)
  select p_user_id, sid, auth.uid()
  from unnest(coalesce(p_store_ids, '{}')) as sid
  on conflict (user_id, store_id) do nothing;
end;
$$;

revoke all on function public.set_store_memberships(uuid, uuid[]) from public, anon;
grant execute on function public.set_store_memberships(uuid, uuid[]) to authenticated;

-- =====================================================================
-- 감사 로그 트리거
-- =====================================================================
create or replace function app.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
  v_store text;
begin
  -- 변경이 없는 UPDATE(updated_at 만 바뀐 경우 포함)는 기록하지 않는다.
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return new;
  end if;

  v_store := case
    when tg_table_name = 'stores' then v_row ->> 'id'
    else v_row ->> 'store_id'
  end;

  insert into public.audit_logs (actor_id, actor_role, action, table_name, record_id, store_id, old_data, new_data)
  values (
    auth.uid(),
    -- SECURITY DEFINER 안에서 current_user 는 함수 소유자이므로, 세션에 설정된 역할(GUC)을 기록한다.
    coalesce(nullif(current_setting('role', true), 'none'), session_user),
    tg_op,
    tg_table_name,
    coalesce(v_row ->> 'id', concat_ws(':', v_row ->> 'user_id', v_row ->> 'store_id')),
    v_store::uuid,
    v_old,
    v_new
  );
  return coalesce(new, old);
end;
$$;

create trigger stores_audit after insert or update or delete on public.stores
  for each row execute function app.audit_row_change();
create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function app.audit_row_change();
create trigger store_members_audit after insert or update or delete on public.store_members
  for each row execute function app.audit_row_change();

-- =====================================================================
-- 권한(GRANT) — anon 은 전면 차단, authenticated 는 RLS 로 제한
-- =====================================================================
revoke all on public.stores, public.profiles, public.store_members, public.audit_logs from anon;
revoke all on public.stores, public.profiles, public.store_members, public.audit_logs from authenticated;

grant select, insert, update on public.stores to authenticated;
grant select, update (full_name, role, is_active, login_id) on public.profiles to authenticated;  -- email 은 서버만 변경
grant select, insert, delete on public.store_members to authenticated;
grant select on public.audit_logs to authenticated;

grant usage on schema app to authenticated, service_role;
revoke all on all functions in schema app from public;
grant execute on function
  app.my_role(), app.is_owner(), app.has_store_access(uuid), app.can_manage_store(uuid),
  app.can_view_store_financials(uuid), app.shares_store_with(uuid),
  app.guard_profile_update(), app.touch_updated_at()
  to authenticated, service_role;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.stores        enable row level security;
alter table public.profiles      enable row level security;
alter table public.store_members enable row level security;
alter table public.audit_logs    enable row level security;

-- stores: 접근 가능한 지점만 조회, 생성/수정은 대표만. 삭제 대신 is_active=false.
create policy stores_select on public.stores
  for select to authenticated
  using (app.has_store_access(id));
create policy stores_insert on public.stores
  for insert to authenticated
  with check (app.is_owner());
create policy stores_update on public.stores
  for update to authenticated
  using (app.is_owner())
  with check (app.is_owner());

-- profiles: 본인, 대표, 같은 지점의 관리자만 조회.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or app.is_owner()
    or (app.my_role() in ('hq_manager', 'store_manager') and app.shares_store_with(id))
  );
-- 본인은 이름만 수정 가능(권한 컬럼은 guard 트리거가 차단), 대표는 전체 수정.
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or app.is_owner())
  with check (id = auth.uid() or app.is_owner());

-- store_members: 본인 소속, 관리 가능한 지점의 소속을 조회. 변경은 대표만.
create policy store_members_select on public.store_members
  for select to authenticated
  using (user_id = auth.uid() or app.can_manage_store(store_id));
create policy store_members_insert on public.store_members
  for insert to authenticated
  with check (app.is_owner());
create policy store_members_delete on public.store_members
  for delete to authenticated
  using (app.is_owner());

-- audit_logs: 대표만 조회. INSERT/UPDATE/DELETE 정책 없음 → 클라이언트에서 불가.
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (app.is_owner());

-- =====================================================================
-- 초기 지점 마스터 (실제 운영 지점. 확인되지 않은 값은 NULL)
-- 1호점 좌석 9석은 사업 정보(다찌 9석)에 근거. 2호점 면적 22평은 '약' 값이므로
-- 대표 확인 전까지 NULL 로 두고 notes 에만 기록한다.
-- =====================================================================
insert into public.stores (code, name, address, seat_count, area_pyeong, notes, sort_order) values
  ('S1', '향미옥 1호점', null, 9,    null, '영등포시장역 인근 · 다찌 9석 중심 (주소 미확인)', 1),
  ('S2', '향미옥 2호점', null, null, null, '영등포시장역 인근 · 약 22평 (좌석수/주소 미확인)', 2),
  ('S3', '향미옥 3호점', null, null, null, '영등포구청역점 (좌석수/주소 미확인)', 3);


-- >>>>> 20261013000100_stage1b_name_login_first_password.sql
-- =====================================================================
-- 1단계 보완: 한글 이름 아이디 + 첫 로그인 비밀번호 변경 강제
-- ---------------------------------------------------------------------
--  * 직원은 '이름'(예: 김민수, 동명이인은 김민수2)으로 로그인한다.
--  * 대표가 계정 생성·비밀번호 초기화 시 must_change_password = true 로 설정하고,
--    사용자가 본인 비밀번호로 바꾸면 서버(시크릿 키)가 false 로 해제한다.
--  * 사용자는 이 값을 직접 바꿀 수 없다 (컬럼 권한 + guard 트리거).
-- =====================================================================

-- 아이디: 한글·영문 소문자·숫자·._- 2~20자
alter table public.profiles drop constraint if exists profiles_login_id_check;
alter table public.profiles
  add constraint profiles_login_id_check
  check (login_id is null or login_id ~ '^[가-힣a-z0-9._-]{2,20}$');

alter table public.profiles
  add column must_change_password boolean not null default false;

comment on column public.profiles.must_change_password is
  'true 이면 로그인 직후 비밀번호 변경 화면으로 보낸다. 해제는 서버(비밀번호 변경 성공 시)만.';

-- 대표는 생성·초기화 시 true 로 설정할 수 있어야 한다.
grant update (must_change_password) on public.profiles to authenticated;

-- guard: must_change_password 도 권한 컬럼으로 취급
create or replace function app.guard_profile_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_is_privileged boolean :=
    current_user in ('postgres', 'service_role', 'supabase_admin') or app.is_owner();
begin
  if (new.role is distinct from old.role
      or new.is_active is distinct from old.is_active
      or new.login_id is distinct from old.login_id
      or new.must_change_password is distinct from old.must_change_password
      or new.id is distinct from old.id)
     and not v_is_privileged then
    raise exception '권한이 없습니다: 역할/활성상태/아이디/비밀번호 변경요구는 대표만 변경할 수 있습니다.'
      using errcode = '42501';
  end if;

  if old.role = 'owner' and old.is_active
     and (new.role <> 'owner' or not new.is_active)
     and not exists (
       select 1 from public.profiles
       where role = 'owner' and is_active and id <> old.id
     ) then
    raise exception '마지막 대표 계정은 강등하거나 비활성화할 수 없습니다.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;


-- >>>>> 20261013000200_stage2_daily_sales.sql
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


-- >>>>> 20261013000300_stage3_expenses.sql
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


-- >>>>> 20261013000400_vendors.sql
-- =====================================================================
-- 3단계 보완: 거래처(매입처) 관리 + 지출에 거래처 연결
-- ---------------------------------------------------------------------
-- 대표 요청 (2026-10-13): '2026 엠앤 향미옥 손익.xlsx' 1·2호점 시트의 원재료(원가율) 거래처를
-- 반영해 큰 틀을 만들고, 세부 정보(품목·연락처 등)는 대표가 직접 채운다.
-- 권한: 지출과 같다 — 대표만 입력·수정, 본사 관리자는 소속 지점 관련 조회, 지점 관리자·직원 불가.
-- =====================================================================

create table public.vendors (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null unique check (char_length(btrim(name)) between 1 and 60),
  default_category_id  uuid references public.expense_categories (id) on delete set null,
  items                text check (items is null or char_length(items) <= 200),       -- 주요 품목
  contact_name         text check (contact_name is null or char_length(contact_name) <= 30),
  phone                text check (phone is null or char_length(phone) <= 30),
  memo                 text check (memo is null or char_length(memo) <= 500),
  sort_order           integer not null default 0,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.vendors is '거래처(매입처). 지출 입력 시 선택하고, 거래처별 매입 현황에 쓴다.';

create trigger vendors_touch before update on public.vendors
  for each row execute function app.touch_updated_at();

-- 어느 지점이 이 거래처와 거래하는지 (지출 입력 화면의 거래처 버튼 목록)
create table public.vendor_stores (
  vendor_id  uuid not null references public.vendors (id) on delete cascade,
  store_id   uuid not null references public.stores (id) on delete restrict,
  primary key (vendor_id, store_id)
);

create index vendor_stores_store_idx on public.vendor_stores (store_id);

alter table public.expenses
  add column vendor_id uuid references public.vendors (id) on delete set null;

create index expenses_vendor_idx on public.expenses (vendor_id, expense_date);

comment on column public.expenses.vendor is '거래처 이름(입력 당시 표기). vendor_id 가 있으면 거래처 관리 목록과 연결됨';

create trigger vendors_audit after insert or update or delete on public.vendors
  for each row execute function app.audit_row_change();
create trigger vendor_stores_audit after insert or update or delete on public.vendor_stores
  for each row execute function app.audit_row_change();

-- 거래처의 거래 지점을 한 트랜잭션으로 교체 (대표만)
create or replace function public.set_vendor_stores(p_vendor_id uuid, p_store_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not app.is_owner() then
    raise exception '권한이 없습니다: 거래처는 대표만 수정할 수 있습니다.' using errcode = '42501';
  end if;

  delete from public.vendor_stores
  where vendor_id = p_vendor_id
    and store_id <> all (coalesce(p_store_ids, '{}'));

  insert into public.vendor_stores (vendor_id, store_id)
  select p_vendor_id, sid
  from unnest(coalesce(p_store_ids, '{}')) as sid
  on conflict (vendor_id, store_id) do nothing;
end;
$$;

-- =====================================================================
-- 권한 · RLS
-- =====================================================================
revoke all on public.vendors, public.vendor_stores from anon, authenticated;
grant select, insert, update, delete on public.vendors, public.vendor_stores to authenticated;
revoke all on function public.set_vendor_stores(uuid, uuid[]) from public, anon;
grant execute on function public.set_vendor_stores(uuid, uuid[]) to authenticated;

alter table public.vendors       enable row level security;
alter table public.vendor_stores enable row level security;

create policy vendors_select on public.vendors
  for select to authenticated
  using (app.my_role() in ('owner', 'hq_manager'));
create policy vendors_insert on public.vendors
  for insert to authenticated with check (app.is_owner());
create policy vendors_update on public.vendors
  for update to authenticated using (app.is_owner()) with check (app.is_owner());
create policy vendors_delete on public.vendors
  for delete to authenticated using (app.is_owner());

create policy vendor_stores_select on public.vendor_stores
  for select to authenticated
  using (app.can_view_store_pnl(store_id));
create policy vendor_stores_insert on public.vendor_stores
  for insert to authenticated with check (app.is_owner());
create policy vendor_stores_delete on public.vendor_stores
  for delete to authenticated using (app.is_owner());

-- =====================================================================
-- 초기 거래처 (출처: 2026 엠앤 향미옥 손익.xlsx — 1·2호점 '원재료' 1~9월)
-- 순서(sort_order) = 1~9월 두 지점 매입 합계가 큰 순서 (지출 입력 화면에서 앞쪽에 보임)
-- 같은 곳으로 보이는 표기는 하나로 합치고, 원래 표기는 memo 에 남겼다 (대표 확인 필요).
-- 3호점 시트는 없어 3호점과는 연결하지 않았다.
-- =====================================================================
insert into public.vendors (name, items, memo, sort_order, default_category_id)
select v.name, v.items, v.memo, v.sort_order, (select id from public.expense_categories where code = 'food')
from (values
  ('엠앤아이',   '육류·소스', '엑셀 표기: 2호점 ''엠앤아이(육류,소스''', 10),
  ('씨앤푸드',   null,        null,                                       20),
  ('투웰브',     null,        null,                                       30),
  ('네이버',     null,        '엑셀 표기: 1호점 ''네이버'', 2호점 ''네이버구매''', 40),
  ('경희상회',   '야채',      '엑셀 표기: 2호점 ''야채/경희상회''',       50),
  ('쿠팡',       null,        null,                                       60),
  ('피플블라썸', '소금',      '엑셀 표기: 2호점 ''소금/피플블라썸''',     70),
  ('개풍',       null,        null,                                       80),
  ('예길식품',   null,        '엑셀 표기: 1호점 ''예길'', 2호점 ''예길식품''', 90),
  ('번영',       null,        null,                                      100),
  ('청수상사',   null,        null,                                      110),
  ('타래주류',   null,        null,                                      120),
  ('쌀값',       '쌀',        '엑셀에 거래처 이름 대신 ''쌀값''으로 적혀 있음 — 실제 거래처 이름으로 바꿔 주세요', 130),
  ('온제육',     null,        null,                                      140),
  ('이곡농산',   null,        null,                                      150),
  ('박동수',     '냅킨',      '엑셀 표기: 2호점 ''냅킨/ 박동수'' (원재료로 분류되어 있음 — 소모품비로 바꿀지 확인)', 160),
  ('참사랑마트', null,        null,                                      170),
  ('농협',       null,        null,                                      180)
) as v(name, items, memo, sort_order);

insert into public.vendor_stores (vendor_id, store_id)
select v.id, s.id
from (values
  ('S1', '타래주류'), ('S1', '쿠팡'), ('S1', '개풍'), ('S1', '네이버'), ('S1', '예길식품'), ('S1', '엠앤아이'),
  ('S1', '투웰브'), ('S1', '씨앤푸드'), ('S1', '청수상사'), ('S1', '번영'), ('S1', '농협'), ('S1', '경희상회'),
  ('S1', '쌀값'),
  ('S2', '타래주류'), ('S2', '이곡농산'), ('S2', '개풍'), ('S2', '네이버'), ('S2', '엠앤아이'), ('S2', '박동수'),
  ('S2', '온제육'), ('S2', '참사랑마트'), ('S2', '쿠팡'), ('S2', '씨앤푸드'), ('S2', '투웰브'), ('S2', '경희상회'),
  ('S2', '피플블라썸'), ('S2', '예길식품'), ('S2', '청수상사')
) as link(store_code, vendor_name)
join public.stores s on s.code = link.store_code
join public.vendors v on v.name = link.vendor_name;


-- >>>>> 20261013000500_vendor_ledger.sql
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


-- >>>>> 20261013000600_stock_reserve.sql
-- =====================================================================
-- 실시간 원가율: 지점별 '냉장고 재고 비율' (대표만 설정)
-- ---------------------------------------------------------------------
-- 대표 요청 (2026-10-13)
--  * 거래처 미수(외상 매입)가 쌓이는 동안 매출 대비 원재료비가 몇 %인지 실시간으로 보고 싶다
--  * 냉장고에 보관 중인 재고가 있으니 매입액에서 5~10%를 빼고 계산. 비율은 대표만 정한다
-- 계산 (앱 src/lib/pnl.ts costOfGoods):
--    사용 원재료(추정) = 이번 달 식재료 매입 − 매입 × 비율
--    원가율 = 사용 원재료 ÷ 이번 달 실매출
--    월말 재고 실사(전월 말 + 이달 말)가 둘 다 있으면 비율 대신 실제 매출원가를 쓴다
-- 권한: stores 수정 정책(stores_update)이 이미 '대표만' → 정책 추가 없음.
--       바꾼 기록은 기존 stores_audit 트리거로 변경 이력에 남는다.
-- =====================================================================

alter table public.stores
  add column stock_reserve_pct numeric(3, 1) not null default 5
    constraint stores_stock_reserve_pct_range check (stock_reserve_pct between 5 and 10);

comment on column public.stores.stock_reserve_pct is
  '냉장고 재고 비율(%). 월말 재고 실사가 없을 때 이번 달 식재료 매입 중 이만큼은 아직 냉장고에 남아 있다고 보고 원가에서 뺀다. 5~10, 대표만 수정';


-- >>>>> 20261013000700_purchase_statements.sql
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


-- >>>>> 20261013000800_quick_delivery.sql
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
