-- =====================================================================
-- 발주 → 밤 9시 텔레그램 → 아침 입고 확인 (구글폼 발주판을 앱으로)
-- ---------------------------------------------------------------------
-- 대표 결정 (2026-10-13)
--  * 품목표: 지점별 구글폼(1호점·2호점 발주판)의 품목을 거래처별로 정리. 3호점은 2호점과 같게 시작
--  * 저녁: 직원·점장이 발주표에서 체크 → [발주 완료] → 밤 9시(한국)에 텔레그램으로 분류별 전송
--  * 아침: 어제 발주를 종이 거래명세표와 품목마다 체크(왔음/안 옴) → 모든 품목 체크 + 거래처 '총금액'만 입력 → [입고 완료]
--    → 그 금액으로 식재료 지출 자동 생성, 외상이면 거래처 미수에 쌓임 → 쌓인 매입으로 매출 대비 원가율
--    (대표 결정 2026-10-13: 줄마다 단가를 맞추지 않고 거래처 총금액만 — 일일정산 앱처럼)
--  * 품목표 단가는 선택(발주표 예상 금액용). 품목표에서 단가를 고치면 밤 9시에 대표에게 알림
--  * 분류 → 거래처: 고기 엠앤아이, 야채 경희상회, 면 투웰브, 식자재 씨앤푸드, 방앗간 개풍, 포장용기 이미진포장(이곡농산에서 이름 변경),
--    음료 청수상사, 마트 참사랑마트, 쿠팡 쿠팡, 네이버 네이버, 주류 타래주류,
--    택배주문은 품목별(깍두기 예길식품, 이북식만두 피플블라썸, 두태기름 엠앤아이, 나머지 거래처 미정)
-- 권한: 보기·발주·입고 확인 = 그 지점 소속 전원(app.has_store_access, 직원 포함). 품목표 고치기 = 대표·본사·지점 관리자.
--       지출은 여전히 대표·본사 관리자만 본다 → 쓰기는 아래 SECURITY DEFINER 함수로만.
-- 텔레그램 열쇠·방 번호는 Vault(대표가 직접 입력), 밤 9시 예약은 pg_cron — supabase/telegram-setup.sql 참고
-- =====================================================================

-- 0) 거래처 이름 변경 (대표 요청)
update public.vendors set name = '이미진포장' where name = '이곡농산';

-- 1) 품목표 (지점별)
create table public.order_items (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references public.stores (id) on delete restrict,
  vendor_id    uuid references public.vendors (id) on delete restrict,
  category     text not null check (char_length(btrim(category)) between 1 and 20),
  name         text not null check (char_length(btrim(name)) between 1 and 40),
  unit         text check (unit is null or char_length(unit) between 1 and 10),
  default_qty  numeric(10, 3) not null default 1 check (default_qty > 0),
  step         numeric(10, 3) not null default 1 check (step > 0),
  unit_price   bigint check (unit_price is null or unit_price between 0 and 999999999),
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles (id) on delete set null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles (id) on delete set null,
  constraint order_items_store_name_key unique (store_id, name)
);

create index order_items_store_idx on public.order_items (store_id, sort_order);

comment on table public.order_items is '발주 품목표(지점별). unit_price 는 참고용 단가(발주표 예상 금액) — 고치면 order_price_changes 에 기록';
comment on column public.order_items.default_qty is '처음 체크할 때 들어가는 평소 수량';
comment on column public.order_items.step is '[+][−] 한 번에 바뀌는 양 (예: 한우사골 10키로, 깐생강 100g)';

-- 2) 단가 변동 기록
create table public.order_price_changes (
  id          bigint generated always as identity primary key,
  store_id    uuid not null references public.stores (id) on delete restrict,
  item_id     uuid not null references public.order_items (id) on delete cascade,
  old_price   bigint,
  new_price   bigint not null,
  changed_at  timestamptz not null default now(),
  changed_by  uuid references public.profiles (id) on delete set null,
  source      text not null default 'receive' check (source in ('receive', 'edit'))
);

create index order_price_changes_store_idx on public.order_price_changes (store_id, changed_at desc);

-- 3) 발주 (지점·날짜당 하나). order_date = 텔레그램으로 보내는 날 (밤 9시 이후 발주는 다음 날)
create table public.orders (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references public.stores (id) on delete restrict,
  order_date    date not null,
  status        text not null default 'open' check (status in ('open', 'submitted', 'sent')),
  submitted_at  timestamptz,
  submitted_by  uuid references public.profiles (id) on delete set null,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles (id) on delete set null,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null,
  constraint orders_store_date_key unique (store_id, order_date)
);

create table public.order_lines (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete cascade,
  item_id      uuid not null references public.order_items (id) on delete restrict,
  qty          numeric(10, 3) not null check (qty > 0),
  recv_status  text check (recv_status is null or recv_status in ('ok', 'missing')),
  received_at  timestamptz,
  constraint order_lines_order_item_key unique (order_id, item_id)
);

create index order_lines_order_idx on public.order_lines (order_id);

-- 4) 입고 확인 (발주 1건 × 거래처): 품목 체크 + 거래명세표 총금액
create table public.order_receipts (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete cascade,
  store_id      uuid not null references public.stores (id) on delete restrict,
  vendor_id     uuid not null references public.vendors (id) on delete restrict,
  amount        bigint not null check (amount between 0 and 9999999999),
  missing_count integer not null default 0 check (missing_count >= 0),
  memo          text check (memo is null or char_length(memo) <= 200),
  expense_id    uuid references public.expenses (id) on delete set null,
  completed_at  timestamptz not null default now(),
  completed_by  uuid references public.profiles (id) on delete set null,
  constraint order_receipts_order_vendor_key unique (order_id, vendor_id)
);

comment on column public.order_receipts.amount is '거래명세표 총금액(부가세 포함) — 이 금액으로 식재료 지출(외상이면 미수)이 생긴다';

-- 공통 트리거
create trigger order_items_stamp before insert or update on public.order_items
  for each row execute function app.stamp_actor();
create trigger order_items_audit after insert or update or delete on public.order_items
  for each row execute function app.audit_row_change();
create trigger orders_stamp before insert or update on public.orders
  for each row execute function app.stamp_actor();
create trigger order_receipts_audit after insert or update or delete on public.order_receipts
  for each row execute function app.audit_row_change();

-- 품목표 단가를 고치면 변동 기록 (밤 9시 텔레그램 [단가 변동])
create or replace function app.log_item_price_edit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.unit_price is distinct from old.unit_price and new.unit_price is not null then
    insert into public.order_price_changes (store_id, item_id, old_price, new_price, changed_by, source)
    values (new.store_id, new.id, old.unit_price, new.unit_price, auth.uid(), 'edit');
  end if;
  return new;
end;
$$;

create trigger order_items_price_log after update of unit_price on public.order_items
  for each row execute function app.log_item_price_edit();

-- =====================================================================
-- 함수
-- =====================================================================

-- 지금 발주하면 어느 날 텔레그램으로 가는지 (한국 시간 밤 9시 이후면 다음 날)
create or replace function app.order_day()
returns date
language sql
stable
set search_path = ''
as $$
  select case
    when extract(hour from (now() at time zone 'Asia/Seoul')) >= 21 then app.seoul_today() + 1
    else app.seoul_today()
  end
$$;

-- 수량 표시: 1.000 → 1, 2.500 → 2.5
create or replace function app.fmt_qty(p numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p = trunc(p) then trunc(p)::bigint::text else rtrim(rtrim(p::text, '0'), '.') end
$$;

-- 발주 저장 (+완료). p_lines = [{"item_id","qty"}]. 빈 배열이면 발주 비우기
create or replace function public.save_order(p_store_id uuid, p_lines jsonb, p_submit boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := app.order_day();
  v_order public.orders%rowtype;
  v_bad integer;
begin
  if auth.uid() is null or not app.has_store_access(p_store_id) then
    raise exception '이 지점의 발주를 할 권한이 없습니다.' using errcode = '42501';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 200 then
    raise exception '발주 형식이 올바르지 않습니다.' using errcode = '22023';
  end if;
  select count(*) into v_bad
  from jsonb_array_elements(p_lines) as l
  where case
    when jsonb_typeof(l) <> 'object' then true
    when coalesce(l ->> 'item_id', '') !~ '^[0-9a-f-]{36}$' then true
    when coalesce(l ->> 'qty', '') !~ '^[0-9]{1,7}([.][0-9]{1,3})?$' then true
    when (l ->> 'qty')::numeric <= 0 then true
    when not exists (
      select 1 from public.order_items i
      where i.id = (l ->> 'item_id')::uuid and i.store_id = p_store_id and i.is_active
    ) then true
    else false
  end;
  if v_bad > 0 then
    raise exception '발주 품목 %개를 확인하세요 (없는 품목이거나 수량 오류).', v_bad using errcode = '22023';
  end if;
  if (select count(distinct l ->> 'item_id') from jsonb_array_elements(p_lines) as l) <> jsonb_array_length(p_lines) then
    raise exception '같은 품목이 두 번 들어 있습니다.' using errcode = '22023';
  end if;

  select * into v_order from public.orders where store_id = p_store_id and order_date = v_day for update;
  if found and v_order.status = 'sent' then
    raise exception '오늘 발주는 이미 텔레그램으로 보냈습니다. 밤 9시 이후에 내일 발주를 넣어 주세요.' using errcode = '22023';
  end if;
  if not found then
    insert into public.orders (store_id, order_date) values (p_store_id, v_day) returning * into v_order;
  end if;

  delete from public.order_lines where order_id = v_order.id;
  insert into public.order_lines (order_id, item_id, qty)
  select v_order.id, i.id, (l ->> 'qty')::numeric
  from jsonb_array_elements(p_lines) as l
  join public.order_items i on i.id = (l ->> 'item_id')::uuid;

  update public.orders
  set status = case
        when jsonb_array_length(p_lines) = 0 then 'open'
        when p_submit then 'submitted'
        else status
      end,
      submitted_at = case when p_submit and jsonb_array_length(p_lines) > 0 then now() else submitted_at end,
      submitted_by = case when p_submit and jsonb_array_length(p_lines) > 0 then auth.uid() else submitted_by end
  where id = v_order.id;

  return v_order.id;
end;
$$;

-- 입고 완료: 거래처 하나의 품목을 모두 체크(왔음/안 옴)하고 거래명세표 총금액을 넣는다.
--  p_lines = [{"line_id","status":"ok|missing"}], p_amount = 총금액(부가세 포함)
--  (거래처 미정 품목은 여기서 고른 거래처로 정해지고 다음부터 기억)
create or replace function public.complete_receipt(
  p_order_id uuid,
  p_vendor_id uuid,
  p_lines jsonb,
  p_amount bigint,
  p_memo text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  v_vendor public.vendors%rowtype;
  v_bad integer;
  v_missing integer;
  v_received integer;
  v_absent integer;
  v_expense uuid;
  v_category uuid;
  v_receipt uuid;
  v_summary text;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode = '42501';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found or not app.has_store_access(o.store_id) then
    raise exception '발주를 찾을 수 없거나 권한이 없습니다.' using errcode = '42501';
  end if;
  if not (o.status = 'sent' or (o.status = 'submitted' and o.order_date < app.seoul_today())) then
    raise exception '아직 보내지 않은 발주입니다. 텔레그램 전송(밤 9시) 뒤에 입고를 확인하세요.' using errcode = '22023';
  end if;
  select * into v_vendor from public.vendors where id = p_vendor_id and is_active;
  if not found then
    raise exception '거래처를 골라 주세요.' using errcode = '22023';
  end if;
  if exists (select 1 from public.order_receipts r where r.order_id = o.id and r.vendor_id = p_vendor_id) then
    raise exception '이 거래처 입고는 이미 확인했습니다.' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception '확인할 품목이 없습니다.' using errcode = '22023';
  end if;

  -- 줄 검사: 이 발주의 줄이고, 거래처가 맞거나 미정, 아직 확인 전, 상태가 올바른지
  select count(*) into v_bad
  from jsonb_array_elements(p_lines) as l
  left join public.order_lines ol
    on ol.id = case when coalesce(l ->> 'line_id', '') ~ '^[0-9a-f-]{36}$' then (l ->> 'line_id')::uuid end
   and ol.order_id = o.id
  left join public.order_items i on i.id = ol.item_id
  where case
    when ol.id is null then true
    when ol.received_at is not null then true
    when i.vendor_id is not null and i.vendor_id <> p_vendor_id then true
    when coalesce(l ->> 'status', '') not in ('ok', 'missing') then true
    else false
  end;
  if v_bad > 0 then
    raise exception '확인 줄 %개가 올바르지 않습니다.', v_bad using errcode = '22023';
  end if;
  if (select count(distinct l ->> 'line_id') from jsonb_array_elements(p_lines) as l) <> jsonb_array_length(p_lines) then
    raise exception '같은 줄이 두 번 들어 있습니다.' using errcode = '22023';
  end if;

  -- 이 거래처로 정해진 품목은 하나도 빠지면 안 된다 (모두 체크해야 완료)
  select count(*) into v_missing
  from public.order_lines ol
  join public.order_items i on i.id = ol.item_id
  where ol.order_id = o.id
    and ol.received_at is null
    and i.vendor_id = p_vendor_id
    and not exists (select 1 from jsonb_array_elements(p_lines) as l where l ->> 'line_id' = ol.id::text);
  if v_missing > 0 then
    raise exception '아직 체크하지 않은 품목이 %개 있습니다. 모든 품목을 체크해 주세요.', v_missing using errcode = '22023';
  end if;

  select count(*) filter (where l ->> 'status' = 'ok'), count(*) filter (where l ->> 'status' = 'missing')
  into v_received, v_absent
  from jsonb_array_elements(p_lines) as l;

  -- 총금액: 받은 품목이 있으면 1원 이상, 하나도 안 왔으면 0원
  if p_amount is null or p_amount < 0 or p_amount > 9999999999 then
    raise exception '거래명세표 총금액을 적어 주세요.' using errcode = '22023';
  end if;
  if v_received > 0 and p_amount = 0 then
    raise exception '받은 품목이 있으면 총금액을 적어 주세요.' using errcode = '22023';
  end if;
  if v_received = 0 and p_amount > 0 then
    raise exception '모든 품목이 안 왔는데 금액이 있습니다. 다시 확인해 주세요.' using errcode = '22023';
  end if;

  update public.order_lines ol
  set recv_status = l ->> 'status',
      received_at = now()
  from jsonb_array_elements(p_lines) as l
  where ol.id = (l ->> 'line_id')::uuid;

  -- 거래처 미정 품목은 이 거래처로 기억
  update public.order_items i
  set vendor_id = p_vendor_id
  from public.order_lines ol
  where ol.item_id = i.id
    and ol.id in (select (l ->> 'line_id')::uuid from jsonb_array_elements(p_lines) as l)
    and i.vendor_id is null;

  -- 받은 품목 요약 (지출 내용에 남김): '숙주5박스, 대파10단 외 2'
  select string_agg(x.label, ', ' order by x.ord)
         || case when max(x.total) > 4 then ' 외 ' || (max(x.total) - 4) else '' end
  into v_summary
  from (
    select i.name || case when i.unit is null and ol.qty = 1 then '' else app.fmt_qty(ol.qty) || coalesce(i.unit, '') end as label,
           row_number() over (order by i.sort_order, i.name) as ord,
           count(*) over () as total
    from public.order_lines ol
    join public.order_items i on i.id = ol.item_id
    where ol.id in (select (l ->> 'line_id')::uuid from jsonb_array_elements(p_lines) as l)
      and ol.recv_status = 'ok'
  ) x
  where x.ord <= 4;

  if p_amount > 0 then
    v_category := coalesce(
      v_vendor.default_category_id,
      (select c.id from public.expense_categories c where c.code = 'food')
    );
    insert into public.expenses (store_id, expense_date, category_id, vendor, vendor_id, description, amount, basis, on_credit)
    values (
      o.store_id,
      app.seoul_today(),
      v_category,
      left(v_vendor.name, 60),
      v_vendor.id,
      left(concat_ws(' · ',
        '입고 확인(' || to_char(o.order_date, 'MM/DD') || ' 발주)',
        v_summary,
        case when v_absent > 0 then '안 옴 ' || v_absent || '개' end,
        nullif(btrim(coalesce(p_memo, '')), '')
      ), 200),
      p_amount,
      'actual',
      v_vendor.on_credit
    )
    returning id into v_expense;
  end if;

  insert into public.order_receipts (order_id, store_id, vendor_id, amount, missing_count, memo, expense_id, completed_by)
  values (o.id, o.store_id, p_vendor_id, p_amount, v_absent, nullif(left(btrim(coalesce(p_memo, '')), 200), ''), v_expense, auth.uid())
  returning id into v_receipt;

  return v_receipt;
end;
$$;

-- 텔레그램 메시지 만들기 (분류별 한 통: [분류] / 지점 / 품목+수량 …) + 단가 변동 + 완료 안 된 발주 알림
create or replace function app.daily_order_messages(p_date date)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  with lines as (
    select i.category,
           s.sort_order as store_sort,
           s.code as store_code,
           replace(s.name, '향미옥 ', '') as store_label,
           i.sort_order,
           -- 텔레그램 모양 그대로: '차돌양지2박스', 단위 없는 1개는 이름만 ('대파채')
           i.name || case when i.unit is null and ol.qty = 1 then '' else app.fmt_qty(ol.qty) || coalesce(i.unit, '') end as label
    from public.orders o
    join public.stores s on s.id = o.store_id
    join public.order_lines ol on ol.order_id = o.id
    join public.order_items i on i.id = ol.item_id
    where o.order_date = p_date and o.status in ('submitted', 'sent')
  ),
  cat_order(category, n) as (
    values ('식자재', 1), ('고기', 2), ('야채', 3), ('면', 4), ('택배주문', 5), ('방앗간', 6), ('쿠팡', 7),
           ('포장용기', 8), ('네이버', 9), ('음료', 10), ('주류', 11), ('마트', 12)
  ),
  per_store as (
    select category, store_sort, store_code,
           store_label || E'\n' || string_agg(label, E'\n' order by sort_order, label) as block
    from lines
    group by category, store_sort, store_code, store_label
  ),
  per_cat as (
    select p.category,
           coalesce(c.n, 99) as n,
           '[' || p.category || ']' || E'\n' || string_agg(p.block, E'\n\n' order by p.store_sort, p.store_code) as msg
    from per_store p
    left join cat_order c on c.category = p.category
    group by p.category, c.n
  ),
  price_changes as (
    select '[단가 변동]' || E'\n' || string_agg(
             replace(s.name, '향미옥 ', '') || ' ' || i.name || ' '
             || coalesce(to_char(pc.old_price, 'FM999,999,999'), '?') || '→' || to_char(pc.new_price, 'FM999,999,999') || '원'
             || case when pc.old_price > 0
                  then ' (' || case when pc.new_price >= pc.old_price then '+' else '' end
                       || to_char(round((pc.new_price - pc.old_price) * 100.0 / pc.old_price, 1), 'FM990.0') || '%)'
                  else '' end
             || coalesce(' ' || p.full_name, ''),
             E'\n' order by s.sort_order, pc.changed_at) as msg
    from public.order_price_changes pc
    join public.order_items i on i.id = pc.item_id
    join public.stores s on s.id = pc.store_id
    left join public.profiles p on p.id = pc.changed_by
    where pc.changed_at >= ((p_date::timestamp - interval '3 hours') at time zone 'Asia/Seoul')
      and pc.changed_at < ((p_date::timestamp + interval '21 hours') at time zone 'Asia/Seoul')
      and pc.old_price is distinct from pc.new_price
    having count(*) > 0
  ),
  unfinished as (
    select '[발주 완료 안 됨]' || E'\n' || string_agg(replace(s.name, '향미옥 ', '') || ' ' || cnt || '개 품목 — 완료 버튼을 누르지 않아 보내지 않았어요', E'\n') as msg
    from (
      select o.store_id, count(ol.id) as cnt
      from public.orders o
      join public.order_lines ol on ol.order_id = o.id
      where o.order_date = p_date and o.status = 'open'
      group by o.store_id
    ) x
    join public.stores s on s.id = x.store_id
    having count(*) > 0
  )
  select msg from (
    select n, msg from per_cat
    union all select 100, msg from unfinished
    union all select 101, msg from price_changes
  ) m
  order by n
$$;

-- 텔레그램 한 통 보내기 (Vault 의 telegram_bot_token / telegram_chat_id 사용, pg_net 비동기 전송)
create or replace function app.telegram_send(p_text text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_chat text;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'telegram_bot_token';
  select decrypted_secret into v_chat from vault.decrypted_secrets where name = 'telegram_chat_id';
  if v_token is null or v_chat is null then
    return false;
  end if;
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || v_token || '/sendMessage',
    body := jsonb_build_object('chat_id', v_chat, 'text', left(p_text, 4000))
  );
  return true;
end;
$$;

-- 밤 9시 예약 실행: 오늘 발주를 보내고 '보냄' 표시 (열쇠가 없으면 보내지 않고 그대로 둔다)
create or replace function app.send_daily_orders(p_day date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := coalesce(p_day, app.seoul_today());
  v_msg text;
  v_sent integer := 0;
begin
  for v_msg in select * from app.daily_order_messages(v_day) loop
    if not app.telegram_send(v_msg) then
      raise warning '텔레그램 열쇠(telegram_bot_token / telegram_chat_id)가 Vault 에 없습니다.';
      return 0;
    end if;
    v_sent := v_sent + 1;
  end loop;
  update public.orders set status = 'sent', sent_at = now()
  where order_date = v_day and status = 'submitted';
  return v_sent;
end;
$$;

-- 대표: 텔레그램 연결 시험 (발주는 보내지 않음)
create or replace function public.send_telegram_test()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_owner() then
    raise exception '대표만 시험 전송을 할 수 있습니다.' using errcode = '42501';
  end if;
  return app.telegram_send('향미옥 경영관리: 텔레그램 연결 시험입니다. 이 메시지가 보이면 밤 9시 발주 전송이 준비된 거예요.');
end;
$$;

-- 대표·관리자: 오늘 발주를 지금 바로 보내기 (밤 9시를 기다리지 않을 때)
create or replace function public.send_orders_now()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (app.is_owner() or app.my_role() in ('hq_manager', 'store_manager')) then
    raise exception '대표·관리자만 바로 보낼 수 있습니다.' using errcode = '42501';
  end if;
  if extract(hour from (now() at time zone 'Asia/Seoul')) >= 21 then
    raise exception '밤 9시 이후에는 이미 보냈거나 내일 발주로 넘어갑니다.' using errcode = '22023';
  end if;
  return app.send_daily_orders(app.seoul_today());
end;
$$;

-- =====================================================================
-- 권한 · RLS
-- =====================================================================
revoke all on public.order_items, public.order_price_changes, public.orders, public.order_lines, public.order_receipts
  from anon, authenticated;
grant select, insert, update on public.order_items to authenticated;
grant select on public.order_price_changes, public.orders, public.order_lines, public.order_receipts to authenticated;

revoke all on function app.log_item_price_edit(), app.order_day(), app.fmt_qty(numeric), app.daily_order_messages(date),
  app.telegram_send(text), app.send_daily_orders(date) from public;
grant execute on function app.log_item_price_edit(), app.order_day(), app.fmt_qty(numeric) to authenticated, service_role;
grant execute on function app.daily_order_messages(date), app.send_daily_orders(date) to service_role;

revoke all on function public.save_order(uuid, jsonb, boolean) from public, anon;
revoke all on function public.complete_receipt(uuid, uuid, jsonb, bigint, text) from public, anon;
revoke all on function public.send_telegram_test() from public, anon;
revoke all on function public.send_orders_now() from public, anon;
grant execute on function public.save_order(uuid, jsonb, boolean) to authenticated;
grant execute on function public.complete_receipt(uuid, uuid, jsonb, bigint, text) to authenticated;
grant execute on function public.send_telegram_test() to authenticated;
grant execute on function public.send_orders_now() to authenticated;

alter table public.order_items         enable row level security;
alter table public.order_price_changes enable row level security;
alter table public.orders              enable row level security;
alter table public.order_lines         enable row level security;
alter table public.order_receipts      enable row level security;

create policy order_items_select on public.order_items
  for select to authenticated using (app.has_store_access(store_id));
create policy order_items_insert on public.order_items
  for insert to authenticated with check (app.can_manage_store(store_id));
create policy order_items_update on public.order_items
  for update to authenticated using (app.can_manage_store(store_id)) with check (app.can_manage_store(store_id));

create policy order_price_changes_select on public.order_price_changes
  for select to authenticated using (app.has_store_access(store_id));
create policy orders_select on public.orders
  for select to authenticated using (app.has_store_access(store_id));
create policy order_lines_select on public.order_lines
  for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and app.has_store_access(o.store_id)));
create policy order_receipts_select on public.order_receipts
  for select to authenticated using (app.has_store_access(store_id));

-- 직원도 발주·입고 화면에서 거래처 이름을 봐야 한다 (거래 중인 곳만)
create policy vendors_select_staff on public.vendors
  for select to authenticated
  using (app.my_role() = 'staff' and is_active);

-- =====================================================================
-- 품목표 초기값 (구글폼 '1호점 발주판'·'2호점 발주판', 2026-10-13 기준)
-- (분류, 거래처, 품목, 단위, 평소 수량, 한 번에 늘리는 양)
-- =====================================================================
create temporary table _seed (
  store_code text, category text, vendor text, name text, unit text, dq numeric, step numeric, ord integer
);

insert into _seed (store_code, category, vendor, name, unit, dq, step, ord)
select 'S1', category, vendor, name, unit, dq, step, ord from (values
  -- 식자재 (씨앤푸드)
  ('식자재', '씨앤푸드', '고기만두', '박스', 1, 1, 101), ('식자재', '씨앤푸드', '김치만두', '박스', 1, 1, 102),
  ('식자재', '씨앤푸드', '냉면무', '팩', 1, 1, 103), ('식자재', '씨앤푸드', '감초', '봉지', 1, 1, 104),
  ('식자재', '씨앤푸드', '월계수잎', '통', 1, 1, 105), ('식자재', '씨앤푸드', '건표고버섯', '봉지', 1, 1, 106),
  ('식자재', '씨앤푸드', '계란지단', '박스', 1, 1, 107), ('식자재', '씨앤푸드', '솔표후추', '봉지', 1, 1, 108),
  ('식자재', '씨앤푸드', '설탕', '봉지', 1, 1, 109), ('식자재', '씨앤푸드', '환만식초(1.6리터)', '통', 1, 1, 110),
  ('식자재', '씨앤푸드', '해선간장', '통', 1, 1, 111), ('식자재', '씨앤푸드', '미원', '봉지', 1, 1, 112),
  ('식자재', '씨앤푸드', '고추장(3키로)', '통', 1, 1, 113), ('식자재', '씨앤푸드', '오뚜기참기름', '통', 1, 1, 114),
  ('식자재', '씨앤푸드', '우스타소스', '통', 1, 1, 115), ('식자재', '씨앤푸드', '물엿(8키로)', '통', 1, 1, 116),
  ('식자재', '씨앤푸드', '재활용파란봉투', '묶음', 1, 1, 117), ('식자재', '씨앤푸드', '진간장', '통', 1, 1, 118),
  ('식자재', '씨앤푸드', '볶음참깨', '봉지', 1, 1, 119), ('식자재', '씨앤푸드', '유니랩 업소용', '통', 1, 1, 120),
  ('식자재', '씨앤푸드', '단무지', '팩', 1, 1, 121), ('식자재', '씨앤푸드', '소금', '봉지', 1, 1, 122),
  ('식자재', '씨앤푸드', '화미 매운미분용고춧가루', '봉지', 1, 1, 123), ('식자재', '씨앤푸드', '화미 미분고춧가루', '봉지', 1, 1, 124),
  ('식자재', '씨앤푸드', '세재', '통', 1, 1, 125),
  -- 고기 (엠앤아이)
  ('고기', '엠앤아이', '차돌양지', '박스', 1, 1, 201), ('고기', '엠앤아이', '한우사골', '키로', 10, 10, 202),
  -- 야채 (경희상회)
  ('야채', '경희상회', '고추채', null, 1, 1, 301), ('야채', '경희상회', '대파채', null, 1, 1, 302),
  ('야채', '경희상회', '양파채', null, 1, 1, 303), ('야채', '경희상회', '숙주', '박스', 1, 1, 304),
  ('야채', '경희상회', '다진마늘', '키로', 1, 1, 305), ('야채', '경희상회', '청로메인', '키로', 1, 1, 306),
  ('야채', '경희상회', '무', '개', 2, 1, 307), ('야채', '경희상회', '통마늘', '키로', 1, 1, 308),
  ('야채', '경희상회', '깐생강', 'g', 100, 100, 309), ('야채', '경희상회', '고수', '단', 1, 1, 310),
  -- 면 (투웰브)
  ('면', '투웰브', '쌀면', '박스', 1, 1, 401),
  -- 택배주문 (품목별 거래처)
  ('택배주문', '엠앤아이', '두태기름', '박스', 1, 1, 501), ('택배주문', '예길식품', '깍두기', '박스', 1, 1, 502),
  -- 방앗간 (개풍)
  ('방앗간', '개풍', '고추씨', '키로', 1, 1, 601), ('방앗간', '개풍', '참기름(방앗간)', '병', 5, 1, 602),
  ('방앗간', '개풍', '매운고춧가루', '근', 2, 1, 603), ('방앗간', '개풍', '안매운고춧가루', '근', 2, 1, 604),
  -- 쿠팡
  ('쿠팡', '쿠팡', '흑통후추', '봉지', 3, 1, 701), ('쿠팡', '쿠팡', '니트릴장갑', '팩', 1, 1, 702),
  ('쿠팡', '쿠팡', '일회용장갑', '팩', 1, 1, 703), ('쿠팡', '쿠팡', '쌀', '포대', 1, 1, 704),
  ('쿠팡', '쿠팡', '고무장갑', '묶음', 1, 1, 705), ('쿠팡', '쿠팡', '수세미', '묶음', 1, 1, 706),
  ('쿠팡', '쿠팡', '냅킨', '박스', 1, 1, 707), ('쿠팡', '쿠팡', '종이컵', '박스', 1, 1, 708),
  ('쿠팡', '쿠팡', '앞치마 1000장', null, 1, 1, 709),
  -- 포장용기 (이미진포장)
  ('포장용기', '이미진포장', '195파이', '박스', 1, 1, 801), ('포장용기', '이미진포장', '105파이', '박스', 1, 1, 802),
  ('포장용기', '이미진포장', '70파이', '박스', 1, 1, 803), ('포장용기', '이미진포장', '비닐', '박스', 1, 1, 804),
  ('포장용기', '이미진포장', '수저·젓가락 세트', '박스', 1, 1, 805),
  -- 네이버
  ('네이버', '네이버', '엄나무', '봉지', 5, 1, 901), ('네이버', '네이버', '냉동베트남고추', '봉지', 5, 1, 902),
  ('네이버', '네이버', '육수면포 150메쉬', '장', 2, 1, 903), ('네이버', '네이버', '해선장', '개', 10, 1, 904),
  ('네이버', '네이버', '스리라차소스', '개', 10, 1, 905), ('네이버', '네이버', '맥코미 블랙페퍼', '개', 1, 1, 906),
  -- 음료 (청수상사) · 주류 (타래주류) · 마트 (참사랑마트)
  ('음료', '청수상사', '제로콜라', '박스', 1, 1, 1001),
  ('주류', '타래주류', '빨간소주', null, 1, 1, 1101),
  ('마트', '참사랑마트', '폐기물 봉투', '묶음', 1, 1, 1201), ('마트', '참사랑마트', '화장실 티슈', '팩', 1, 1, 1202),
  ('마트', '참사랑마트', '종량제 쓰레기봉투', '팩', 1, 1, 1203), ('마트', '참사랑마트', '두루마리 휴지', '팩', 1, 1, 1204)
) as t(category, vendor, name, unit, dq, step, ord);

insert into _seed (store_code, category, vendor, name, unit, dq, step, ord)
select 'S2', category, vendor, name, unit, dq, step, ord from (values
  -- 야채 (경희상회)
  ('야채', '경희상회', '홍고추', '키로', 1, 1, 301), ('야채', '경희상회', '청양고추', '키로', 1, 1, 302),
  ('야채', '경희상회', '대파', '단', 10, 1, 303), ('야채', '경희상회', '대파(다대기용)', '단', 2, 1, 304),
  ('야채', '경희상회', '깐양파(10키로)', '망', 1, 1, 305), ('야채', '경희상회', '숙주', '박스', 5, 1, 306),
  ('야채', '경희상회', '다진마늘', '키로', 1, 1, 307), ('야채', '경희상회', '청로메인', '키로', 1, 1, 308),
  ('야채', '경희상회', '무', '개', 5, 1, 309), ('야채', '경희상회', '통마늘', '키로', 1, 1, 310),
  ('야채', '경희상회', '깐생강', 'g', 500, 100, 311), ('야채', '경희상회', '고수', '단', 2, 1, 312),
  -- 식자재 (씨앤푸드)
  ('식자재', '씨앤푸드', '고기만두', '박스', 1, 1, 101), ('식자재', '씨앤푸드', '김치만두', '박스', 1, 1, 102),
  ('식자재', '씨앤푸드', '냉면무', '팩', 1, 1, 103), ('식자재', '씨앤푸드', '감초', '봉지', 1, 1, 104),
  ('식자재', '씨앤푸드', '월계수잎', '통', 1, 1, 105), ('식자재', '씨앤푸드', '건표고버섯', '봉지', 1, 1, 106),
  ('식자재', '씨앤푸드', '계란지단', '박스', 1, 1, 107), ('식자재', '씨앤푸드', '솔표후추', '봉지', 3, 1, 108),
  ('식자재', '씨앤푸드', '설탕', '봉지', 2, 1, 109), ('식자재', '씨앤푸드', '환만식초(말통)', '통', 1, 1, 110),
  ('식자재', '씨앤푸드', '해선간장', '통', 1, 1, 111), ('식자재', '씨앤푸드', '이금기 치킨스톡', '통', 1, 1, 112),
  ('식자재', '씨앤푸드', '굴소스', '봉지', 1, 1, 113), ('식자재', '씨앤푸드', '미원', '봉지', 1, 1, 114),
  ('식자재', '씨앤푸드', '고추장(말통)', '통', 1, 1, 115), ('식자재', '씨앤푸드', '다시다', '봉지', 1, 1, 116),
  ('식자재', '씨앤푸드', '우스타소스', '통', 1, 1, 117), ('식자재', '씨앤푸드', '물엿(8키로)', '통', 1, 1, 118),
  ('식자재', '씨앤푸드', '재활용파란봉투', '묶음', 1, 1, 119), ('식자재', '씨앤푸드', '세재', '통', 1, 1, 120),
  ('식자재', '씨앤푸드', '오뚜기참기름', '통', 1, 1, 121), ('식자재', '씨앤푸드', '진간장', '통', 1, 1, 122),
  ('식자재', '씨앤푸드', '볶음참깨', '봉지', 1, 1, 123), ('식자재', '씨앤푸드', '식용유(말통)', '통', 1, 1, 124),
  ('식자재', '씨앤푸드', '유니랩 업소용', '통', 1, 1, 125), ('식자재', '씨앤푸드', '떡갈비', '봉지', 3, 1, 126),
  ('식자재', '씨앤푸드', '가지튀김', '봉지', 3, 1, 127), ('식자재', '씨앤푸드', '단무지', '팩', 2, 1, 128),
  ('식자재', '씨앤푸드', '화미 매운고춧가루', '봉지', 1, 1, 129), ('식자재', '씨앤푸드', '화미 미분고춧가루', '봉지', 1, 1, 130),
  -- 고기 (엠앤아이)
  ('고기', '엠앤아이', '차돌양지', '박스', 3, 1, 201), ('고기', '엠앤아이', '한우사골', '키로', 20, 10, 202),
  ('고기', '엠앤아이', '갈비', '박스', 1, 1, 203),
  -- 면 (투웰브)
  ('면', '투웰브', '쌀면', '박스', 3, 1, 401), ('면', '투웰브', '감자말이새우', '봉지', 5, 1, 402),
  ('면', '투웰브', '고구마롤', '봉지', 5, 1, 403), ('면', '투웰브', '텃만쿵', '박스', 1, 1, 404),
  ('면', '투웰브', '멘보샤', '박스', 1, 1, 405),
  -- 택배주문 (품목별 거래처, 모르는 곳은 미정)
  ('택배주문', '피플블라썸', '이북식만두', '박스', 2, 1, 501), ('택배주문', null, '세재(식기세척기)', '통', 1, 1, 502),
  ('택배주문', null, '린스(식기세척기)', '통', 1, 1, 503), ('택배주문', '엠앤아이', '두태기름', '박스', 1, 1, 504),
  ('택배주문', '예길식품', '깍두기', '박스', 2, 1, 505), ('택배주문', null, '현미유', null, 1, 1, 506),
  -- 방앗간 (개풍)
  ('방앗간', '개풍', '고추씨', '키로', 1, 1, 601), ('방앗간', '개풍', '참기름(방앗간)', '병', 5, 1, 602),
  ('방앗간', '개풍', '매운고춧가루', '근', 2, 1, 603), ('방앗간', '개풍', '안매운고춧가루', '근', 2, 1, 604),
  -- 쿠팡
  ('쿠팡', '쿠팡', '흑통후추', '봉지', 5, 1, 701), ('쿠팡', '쿠팡', '니트릴장갑', '팩', 1, 1, 702),
  ('쿠팡', '쿠팡', '일회용장갑', '팩', 1, 1, 703), ('쿠팡', '쿠팡', '슈퍼타이', '봉지', 1, 1, 704),
  ('쿠팡', '쿠팡', '쌀', '포대', 1, 1, 705), ('쿠팡', '쿠팡', '고무장갑', '묶음', 1, 1, 706),
  ('쿠팡', '쿠팡', '수세미', '묶음', 1, 1, 707), ('쿠팡', '쿠팡', '칠리소스', '통', 1, 1, 708),
  ('쿠팡', '쿠팡', '냅킨', '박스', 1, 1, 709), ('쿠팡', '쿠팡', '종이컵', '박스', 1, 1, 710),
  ('쿠팡', '쿠팡', '앞치마 1000장', null, 1, 1, 711),
  -- 포장용기 (이미진포장)
  ('포장용기', '이미진포장', '195파이', '박스', 1, 1, 801), ('포장용기', '이미진포장', '105파이', '박스', 1, 1, 802),
  ('포장용기', '이미진포장', '70파이', '박스', 1, 1, 803), ('포장용기', '이미진포장', '비닐', '박스', 1, 1, 804),
  ('포장용기', '이미진포장', '수저·젓가락 세트', '박스', 1, 1, 805),
  -- 네이버
  ('네이버', '네이버', '아기상어 어묵', '봉지', 1, 1, 901), ('네이버', '네이버', '둥굴레차 액상', '박스', 1, 1, 902),
  ('네이버', '네이버', '오징어젓갈', '통', 1, 1, 903), ('네이버', '네이버', '진공롤백', '박스', 1, 1, 904),
  ('네이버', '네이버', '냉동베트남고추', '봉지', 1, 1, 905), ('네이버', '네이버', '짜조', '박스', 1, 1, 906),
  ('네이버', '네이버', '엄나무', '봉지', 1, 1, 907), ('네이버', '네이버', '육수면포 150메쉬', '장', 1, 1, 908),
  ('네이버', '네이버', '해선장', '개', 1, 1, 909), ('네이버', '네이버', '맥코미 블랙페퍼 테이블 후추', '개', 1, 1, 910),
  -- 음료 (청수상사) · 마트 (참사랑마트)
  ('음료', '청수상사', '콜라', '박스', 1, 1, 1001), ('음료', '청수상사', '제로콜라', '박스', 1, 1, 1002),
  ('음료', '청수상사', '사이다', '박스', 1, 1, 1003),
  ('마트', '참사랑마트', '폐기물 봉투', '묶음', 1, 1, 1201), ('마트', '참사랑마트', '화장실 티슈', '팩', 1, 1, 1202),
  ('마트', '참사랑마트', '종량제 쓰레기봉투', '팩', 1, 1, 1203), ('마트', '참사랑마트', '두루마리 휴지', '팩', 1, 1, 1204),
  ('마트', '참사랑마트', '음식물 스티커(동진환경)', '장', 1, 1, 1205)
) as t(category, vendor, name, unit, dq, step, ord);

-- 3호점은 2호점과 같게 시작 (대표 확인 전 기본값)
insert into _seed (store_code, category, vendor, name, unit, dq, step, ord)
select 'S3', category, vendor, name, unit, dq, step, ord from _seed where store_code = 'S2';

insert into public.order_items (store_id, vendor_id, category, name, unit, default_qty, step, sort_order)
select s.id, v.id, x.category, x.name, x.unit, x.dq, x.step, x.ord
from _seed x
join public.stores s on s.code = x.store_code
left join public.vendors v on v.name = x.vendor
on conflict (store_id, name) do nothing;

drop table _seed;
