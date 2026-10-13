import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDb, createUser, storeId } from "./harness";

const OWNER = "00000000-0000-4000-8000-0000000000d1";
const MGR1 = "00000000-0000-4000-8000-0000000000d2";
const STAFF1 = "00000000-0000-4000-8000-0000000000d3";
const STAFF2 = "00000000-0000-4000-8000-0000000000d4";

let db: PGlite;
let s1: string;
let s2: string;

const item = async (store: string, name: string) =>
  (
    await db.query<{ id: string; unit_price: number | null; vendor_id: string | null }>(
      `select id, unit_price::int, vendor_id from public.order_items where store_id = $1 and name = $2`,
      [store, name],
    )
  ).rows[0];
const vendorId = async (name: string) => (await db.query<{ id: string }>(`select id from public.vendors where name = $1`, [name])).rows[0].id;

const saveOrder = (uid: string, store: string, lines: { item_id: string; qty: number | string }[], submit = true) =>
  asUser(db, uid, (tx) =>
    tx.query<{ id: string }>(`select public.save_order($1, $2::jsonb, $3) as id`, [store, JSON.stringify(lines), submit]),
  );

const orderOf = async (id: string) =>
  (await db.query<{ status: string; order_date: string }>(`select status, order_date::text from public.orders where id = $1`, [id])).rows[0];

const linesOf = async (orderId: string) =>
  (
    await db.query<{ id: string; name: string; qty: string }>(
      `select ol.id, i.name, ol.qty::text from public.order_lines ol join public.order_items i on i.id = ol.item_id where ol.order_id = $1`,
      [orderId],
    )
  ).rows;

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, { id: OWNER, name: "대표", role: "owner" });
  await createUser(db, { id: MGR1, name: "1호점장", role: "store_manager", storeCodes: ["S1"] });
  await createUser(db, { id: STAFF1, name: "1호점직원", role: "staff", storeCodes: ["S1"] });
  await createUser(db, { id: STAFF2, name: "2호점직원", role: "staff", storeCodes: ["S2"] });
  s1 = await storeId(db, "S1");
  s2 = await storeId(db, "S2");
  // 텔레그램 전송 모사: Vault 비밀값 표 + pg_net 의 http_post (보낸 내용 기록)
  await db.exec(`
    create schema vault;
    create table vault.decrypted_secrets (name text, decrypted_secret text);
    create schema net;
    create table net._sent (url text, body jsonb);
    create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 2000)
    returns bigint language sql as $$ insert into net._sent values (url, body) returning 1::bigint $$;
  `);
}, 60_000);

describe("품목표 (구글폼에서 정리)", () => {
  it("지점별 품목과 분류별 거래처가 들어간다, 3호점은 2호점과 같다", async () => {
    const n = async (code: string) =>
      (
        await db.query<{ n: number }>(
          `select count(*)::int n from public.order_items i join public.stores s on s.id = i.store_id where s.code = $1`,
          [code],
        )
      ).rows[0].n;
    expect(await n("S1")).toBe(70);
    expect(await n("S2")).toBe(94);
    expect(await n("S3")).toBe(94);
    const map = await db.query<{ category: string; vendor: string }>(
      `select distinct i.category, v.name as vendor from public.order_items i join public.vendors v on v.id = i.vendor_id
       where i.store_id = $1 and i.category in ('고기', '야채', '면', '식자재', '방앗간', '포장용기', '음료', '마트')
       order by 1`,
      [s2],
    );
    expect(Object.fromEntries(map.rows.map((r) => [r.category, r.vendor]))).toEqual({
      고기: "엠앤아이",
      마트: "참사랑마트",
      면: "투웰브",
      방앗간: "개풍",
      식자재: "씨앤푸드",
      야채: "경희상회",
      음료: "청수상사",
      포장용기: "이미진포장",
    });
    expect((await item(s2, "깍두기")).vendor_id).toBe(await vendorId("예길식품"));
    expect((await item(s2, "이북식만두")).vendor_id).toBe(await vendorId("피플블라썸"));
    expect((await item(s2, "현미유")).vendor_id).toBeNull(); // 거래처 미정
    expect((await db.query(`select 1 from public.vendors where name = '이곡농산'`)).rows).toHaveLength(0);
  });

  it("직원도 자기 지점 품목·단가를 보지만 고칠 수는 없다, 다른 지점은 안 보인다", async () => {
    const rows = await asUser(db, STAFF1, (tx) => tx.query<{ store_id: string }>(`select store_id from public.order_items`));
    expect(rows.rows.length).toBe(70);
    expect(rows.rows.every((r) => r.store_id === s1)).toBe(true);
    const u = await asUser(db, STAFF1, (tx) => tx.query(`update public.order_items set unit_price = 1 where store_id = $1`, [s1]));
    expect(u.affectedRows).toBe(0);
    const v = await asUser(db, STAFF1, (tx) => tx.query(`select name from public.vendors`));
    expect(v.rows.length).toBeGreaterThan(0); // 거래처 이름은 보인다
  });

  it("점장이 단가를 고치면 변동 기록이 남는다", async () => {
    const sukju = await item(s1, "숙주");
    await asUser(db, MGR1, (tx) => tx.query(`update public.order_items set unit_price = 15000 where id = $1`, [sukju.id]));
    await asUser(db, MGR1, (tx) => tx.query(`update public.order_items set unit_price = 16000 where id = $1`, [sukju.id]));
    const r = await db.query<{ old_price: number | null; new_price: number; source: string; changed_by: string }>(
      `select old_price::int, new_price::int, source, changed_by from public.order_price_changes where item_id = $1 order by id`,
      [sukju.id],
    );
    expect(r.rows).toEqual([
      { old_price: null, new_price: 15000, source: "edit", changed_by: MGR1 },
      { old_price: 15000, new_price: 16000, source: "edit", changed_by: MGR1 },
    ]);
  });
});

describe("저녁 발주", () => {
  let order1: string;

  it("직원이 체크하고 [발주 완료] → 텔레그램 보낼 날짜로 저장", async () => {
    const chadol = await item(s1, "차돌양지");
    const sukju = await item(s1, "숙주");
    const r = await saveOrder(STAFF1, s1, [
      { item_id: chadol.id, qty: 2 },
      { item_id: sukju.id, qty: "1.5" },
    ]);
    order1 = r.rows[0].id;
    const o = await orderOf(order1);
    const day = (await db.query<{ d: string }>(`select app.order_day()::text d`)).rows[0].d;
    expect(o).toEqual({ status: "submitted", order_date: day });
    expect((await linesOf(order1)).map((l) => [l.name, Number(l.qty)]).sort()).toEqual([
      ["숙주", 1.5],
      ["차돌양지", 2],
    ]);
  });

  it("다시 저장하면 새 내용으로 바뀐다 (같은 날 발주는 하나)", async () => {
    const sukju = await item(s1, "숙주");
    const r = await saveOrder(MGR1, s1, [{ item_id: sukju.id, qty: 3 }]);
    expect(r.rows[0].id).toBe(order1);
    expect((await linesOf(order1)).map((l) => l.name)).toEqual(["숙주"]);
  });

  it("다른 지점 품목·다른 지점 직원·중복·0 수량은 거부", async () => {
    const other = await item(s2, "숙주");
    await expect(saveOrder(STAFF1, s1, [{ item_id: other.id, qty: 1 }])).rejects.toThrow(/확인하세요/);
    await expect(saveOrder(STAFF2, s1, [])).rejects.toThrow(/권한이 없습니다/);
    const sukju = await item(s1, "숙주");
    await expect(
      saveOrder(STAFF1, s1, [
        { item_id: sukju.id, qty: 1 },
        { item_id: sukju.id, qty: 2 },
      ]),
    ).rejects.toThrow(/두 번/);
    await expect(saveOrder(STAFF1, s1, [{ item_id: sukju.id, qty: 0 }])).rejects.toThrow(/확인하세요/);
  });

  it("발주 표는 직접 고칠 수 없다 (함수로만)", async () => {
    await expect(asUser(db, STAFF1, (tx) => tx.query(`update public.orders set status = 'sent'`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, MGR1, (tx) => tx.query(`delete from public.order_lines`))).rejects.toThrow(/permission denied/);
  });
});

describe("밤 9시 텔레그램", () => {
  let day: string;

  beforeAll(async () => {
    day = (await db.query<{ d: string }>(`select app.order_day()::text d`)).rows[0].d;
    // 1호점: 차돌양지 2박스 + 대파채(단위 없음 1개), 2호점: 숙주 5박스 + 한우사골 20키로 + 다시다
    const [chadol, daepa] = [await item(s1, "차돌양지"), await item(s1, "대파채")];
    await saveOrder(STAFF1, s1, [
      { item_id: chadol.id, qty: 2 },
      { item_id: daepa.id, qty: 1 },
    ]);
    const [sukju, sagol, dasida] = [await item(s2, "숙주"), await item(s2, "한우사골"), await item(s2, "다시다")];
    await saveOrder(STAFF2, s2, [
      { item_id: sukju.id, qty: 5 },
      { item_id: sagol.id, qty: 20 },
      { item_id: dasida.id, qty: 1 },
    ]);
  });

  it("분류별 한 통: [분류] / 지점 / 품목+수량 (지금 텔레그램과 같은 모양)", async () => {
    const r = await db.query<{ msg: string }>(`select * from app.daily_order_messages($1::date) as msg`, [day]);
    const msgs = r.rows.map((x) => x.msg);
    expect(msgs).toContain("[식자재]\n2호점\n다시다1봉지");
    expect(msgs).toContain("[고기]\n1호점\n차돌양지2박스\n\n2호점\n한우사골20키로");
    expect(msgs).toContain("[야채]\n1호점\n대파채\n\n2호점\n숙주5박스");
    expect(msgs.some((m) => m.startsWith("[단가 변동]") && m.includes("1호점 숙주 15,000→16,000원 (+6.7%)"))).toBe(true);
  });

  it("열쇠가 없으면 보내지 않고 '완료' 상태로 둔다", async () => {
    const r = await db.query<{ n: number }>(`select app.send_daily_orders($1::date) as n`, [day]);
    expect(r.rows[0].n).toBe(0);
    expect((await db.query(`select 1 from public.orders where order_date = $1 and status = 'sent'`, [day])).rows).toHaveLength(0);
  });

  it("열쇠가 있으면 분류마다 보내고 '보냄'으로 바꾼다, 그 뒤엔 그날 발주를 고칠 수 없다", async () => {
    await db.query(`insert into vault.decrypted_secrets values ('telegram_bot_token', 'TEST:TOKEN'), ('telegram_chat_id', '-100123')`);
    const r = await db.query<{ n: number }>(`select app.send_daily_orders($1::date) as n`, [day]);
    const sent = await db.query<{ url: string; body: { chat_id: string; text: string } }>(`select url, body from net._sent`);
    expect(r.rows[0].n).toBe(sent.rows.length);
    expect(sent.rows[0].url).toBe("https://api.telegram.org/botTEST:TOKEN/sendMessage");
    expect(sent.rows[0].body.chat_id).toBe("-100123");
    const status = await db.query<{ status: string }>(`select distinct status from public.orders where order_date = $1`, [day]);
    expect(status.rows.map((x) => x.status)).toEqual(["sent"]);
    const sukju = await item(s1, "숙주");
    await expect(saveOrder(STAFF1, s1, [{ item_id: sukju.id, qty: 1 }])).rejects.toThrow(/이미 텔레그램으로 보냈습니다/);
  });

  it("시험 전송·바로 보내기는 직원이 못 한다", async () => {
    await expect(asUser(db, STAFF1, (tx) => tx.query(`select public.send_telegram_test()`))).rejects.toThrow(/대표만/);
    await expect(asUser(db, STAFF1, (tx) => tx.query(`select public.send_orders_now()`))).rejects.toThrow(/관리자만/);
    const ok = await asUser(db, OWNER, (tx) => tx.query<{ ok: boolean }>(`select public.send_telegram_test() as ok`));
    expect(ok.rows[0].ok).toBe(true);
  });
});

describe("아침 입고 확인", () => {
  let orderId: string;
  let lines: { id: string; name: string }[];
  let mni: string;

  const complete = (
    uid: string,
    vendor: string,
    ls: { line_id: string; status: string; qty?: string | number; price?: string | number }[],
    opts: { vat?: number; total?: number | null; memo?: string | null; order?: string } = {},
  ) =>
    asUser(db, uid, (tx) =>
      tx.query<{ id: string }>(`select public.complete_receipt($1, $2, $3::jsonb, $4, $5, $6) as id`, [
        opts.order ?? orderId,
        vendor,
        JSON.stringify(ls),
        opts.vat ?? 0,
        opts.total ?? null,
        opts.memo ?? null,
      ]),
    );

  beforeAll(async () => {
    orderId = (
      await db.query<{ id: string }>(`select id from public.orders where store_id = $1 and status = 'sent'`, [s1])
    ).rows[0].id;
    lines = await linesOf(orderId);
    mni = await vendorId("엠앤아이");
    // 차돌양지 단가: 32,000 (점장이 품목표에 미리 입력)
    await asUser(db, MGR1, (tx) => tx.query(`update public.order_items set unit_price = 32000 where store_id = $1 and name = '차돌양지'`, [s1]));
    await db.query(`update public.order_lines set unit_price = 32000 where id = $1`, [lines.find((l) => l.name === "차돌양지")!.id]);
  });

  it("거래처 줄을 다 체크하지 않으면 완료 안 됨", async () => {
    const daepa = lines.find((l) => l.name === "대파채")!;
    // 엠앤아이 줄(차돌양지)을 빼고 경희상회 줄만 보내면 엠앤아이로는 완료 불가
    await expect(complete(STAFF1, mni, [{ line_id: daepa.id, status: "missing" }])).rejects.toThrow(/올바르지 않습니다/);
  });

  it("단가를 모르는 품목을 '같음'으로 하면 거부 → '다름'으로 단가를 적어야 한다", async () => {
    const daepa = lines.find((l) => l.name === "대파채")!;
    const gh = await vendorId("경희상회");
    await expect(complete(STAFF1, gh, [{ line_id: daepa.id, status: "ok" }])).rejects.toThrow(/단가 모르는 품목/);
  });

  it("영수증 합계가 다르면 이유 없이는 완료 안 됨", async () => {
    const chadol = lines.find((l) => l.name === "차돌양지")!;
    await expect(complete(STAFF1, mni, [{ line_id: chadol.id, status: "changed", qty: 2, price: 33000 }], { total: 60000 })).rejects.toThrow(
      /다릅니다/,
    );
  });

  it("직원이 단가 변경을 확인하고 완료 → 지출(외상)+품목 줄, 품목표 단가 갱신, 변동 기록", async () => {
    const chadol = lines.find((l) => l.name === "차돌양지")!;
    const r = await complete(STAFF1, mni, [{ line_id: chadol.id, status: "changed", qty: 2, price: 33000 }], { total: 66000, vat: 0 });
    expect(r.rows[0].id).toBeTruthy();

    const rc = await db.query<{ computed_total: number; expense_id: string; completed_by: string }>(
      `select computed_total::int, expense_id, completed_by from public.order_receipts where id = $1`,
      [r.rows[0].id],
    );
    expect(rc.rows[0]).toMatchObject({ computed_total: 66000, completed_by: STAFF1 });
    const e = await db.query<{ amount: number; on_credit: boolean; vendor_id: string; created_by: string }>(
      `select amount::int, on_credit, vendor_id, created_by from public.expenses where id = $1`,
      [rc.rows[0].expense_id],
    );
    expect(e.rows[0]).toEqual({ amount: 66000, on_credit: true, vendor_id: mni, created_by: STAFF1 });
    const el = await db.query<{ item_name: string; quantity: string; unit_price: number }>(
      `select item_name, quantity::text, unit_price::int from public.expense_lines where expense_id = $1`,
      [rc.rows[0].expense_id],
    );
    expect(el.rows.map((x) => [x.item_name, Number(x.quantity), x.unit_price])).toEqual([["차돌양지", 2, 33000]]);

    expect((await item(s1, "차돌양지")).unit_price).toBe(33000);
    const pc = await db.query<{ old_price: number; new_price: number; source: string; changed_by: string }>(
      `select old_price::int, new_price::int, source, changed_by from public.order_price_changes
       where item_id = (select id from public.order_items where store_id = $1 and name = '차돌양지') order by id desc limit 1`,
      [s1],
    );
    expect(pc.rows[0]).toEqual({ old_price: 32000, new_price: 33000, source: "receive", changed_by: STAFF1 });
  });

  it("같은 거래처를 두 번 완료할 수 없다", async () => {
    const chadol = lines.find((l) => l.name === "차돌양지")!;
    await expect(complete(STAFF1, mni, [{ line_id: chadol.id, status: "ok" }])).rejects.toThrow(/이미 확인했습니다/);
  });

  it("안 온 것만 있으면 지출 없이 확인 기록만", async () => {
    const daepa = lines.find((l) => l.name === "대파채")!;
    const gh = await vendorId("경희상회");
    const r = await complete(MGR1, gh, [{ line_id: daepa.id, status: "missing" }]);
    const rc = await db.query<{ computed_total: number; expense_id: string | null }>(
      `select computed_total::int, expense_id from public.order_receipts where id = $1`,
      [r.rows[0].id],
    );
    expect(rc.rows[0]).toEqual({ computed_total: 0, expense_id: null });
  });

  it("다른 지점 직원은 입고 확인 불가, 직원은 지출 표를 못 본다", async () => {
    const o2 = (await db.query<{ id: string }>(`select id from public.orders where store_id = $1 and status = 'sent'`, [s2])).rows[0].id;
    const l2 = await linesOf(o2);
    await expect(
      complete(STAFF1, mni, [{ line_id: l2.find((l) => l.name === "한우사골")!.id, status: "changed", qty: 20, price: 9000 }], { order: o2 }),
    ).rejects.toThrow(/권한이 없습니다/);
    const e = await asUser(db, STAFF1, (tx) => tx.query(`select * from public.expenses`));
    expect(e.rows).toHaveLength(0);
  });

  it("거래처 미정 품목은 입고 때 고른 거래처로 기억된다", async () => {
    // 2호점 내일 발주: 현미유(미정) → 보낸 것으로 만들고 입고 확인
    const hyunmi = await item(s2, "현미유");
    const o = (await db.query<{ id: string }>(
      `insert into public.orders (store_id, order_date, status) values ($1, app.seoul_today() - 1, 'submitted') returning id`,
      [s2],
    )).rows[0].id;
    const line = (await db.query<{ id: string }>(
      `insert into public.order_lines (order_id, item_id, qty) values ($1, $2, 1) returning id`,
      [o, hyunmi.id],
    )).rows[0].id;
    const cnf = await vendorId("씨앤푸드");
    await complete(STAFF2, cnf, [{ line_id: line, status: "changed", qty: 1, price: 45000 }], { order: o });
    expect((await item(s2, "현미유")).vendor_id).toBe(cnf);
    expect((await item(s2, "현미유")).unit_price).toBe(45000);
  });

  it("아직 보내지 않은 오늘 발주는 입고 확인 불가", async () => {
    const today = (await db.query<{ id: string }>(
      `insert into public.orders (store_id, order_date, status) values ($1, app.seoul_today() + 5, 'submitted') returning id`,
      [s1],
    )).rows[0].id;
    await expect(complete(STAFF1, mni, [{ line_id: lines[0].id, status: "ok" }], { order: today })).rejects.toThrow(/아직 보내지 않은/);
  });
});
