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
