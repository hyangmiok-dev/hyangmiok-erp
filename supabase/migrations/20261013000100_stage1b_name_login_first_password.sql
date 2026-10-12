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
