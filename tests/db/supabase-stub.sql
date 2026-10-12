-- 테스트 전용: Supabase 가 제공하는 역할/auth 스키마의 최소 모사.
-- 실제 Supabase 에는 이미 존재하므로 이 파일은 마이그레이션에 포함하지 않는다.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- Supabase 의 auth.uid() 와 동일하게 JWT claims 의 sub 를 읽는다.
create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase 기본 권한: public 스키마의 신규 테이블은 API 역할에 전부 부여된다.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
