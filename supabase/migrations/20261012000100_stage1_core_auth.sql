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
