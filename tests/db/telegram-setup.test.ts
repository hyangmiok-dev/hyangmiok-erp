import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

// 대표가 SQL Editor 에서 실행하는 supabase/telegram-setup.sql 을 Vault·pg_cron 모사 위에서 그대로 실행해 본다.
// (pg_net·pg_cron 확장은 PGlite 에 없으므로 create extension 줄만 빼고 실행)
const SQL = readFileSync(join(__dirname, "..", "..", "supabase", "telegram-setup.sql"), "utf8").replace(
  /^create extension .*$/gm,
  "",
);
const TOKEN = `1234567890:AAH${"a".repeat(32)}`;
// 대표가 한글 자리를 더블클릭 → 붙여넣기 한 것과 같게 바꿈 (함수로 넘겨 $' 같은 치환 기호를 막음)
const fill = (token: string, chat: string) =>
  SQL.replace("$t$여기에_봇_토큰$t$", () => `$t$${token}$t$`).replace("$t$여기에_방_번호$t$", () => `$t$${chat}$t$`);

let db: PGlite;
const secrets = async () =>
  Object.fromEntries(
    (await db.query<{ name: string; secret: string }>(`select name, secret from vault.secrets`)).rows.map((r) => [r.name, r.secret]),
  );
const jobs = async () => (await db.query<{ schedule: string; command: string }>(`select schedule, command from cron.job`)).rows;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    create schema vault;
    create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text, secret text);
    create view vault.decrypted_secrets as select id, name, description, secret as decrypted_secret from vault.secrets;
    create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
    returns uuid language sql as $$ insert into vault.secrets (name, description, secret) values (new_name, new_description, new_secret) returning id $$;
    create function vault.update_secret(secret_id uuid, new_secret text default null)
    returns void language sql as $$ update vault.secrets set secret = new_secret where id = secret_id $$;
    create schema cron;
    create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
    create function cron.schedule(p_name text, p_schedule text, p_command text)
    returns bigint language sql as $$
      insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
      on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
  `);
}, 60_000); // 다른 DB 테스트와 동시에 돌면 PGlite 시작이 느릴 수 있음

describe("텔레그램 설정 SQL (대표가 SQL Editor 에서 실행)", () => {
  it("①·② 를 안 바꾸고 Run 하면 아무것도 저장하지 않고 한국어로 알려 준다", async () => {
    await expect(db.exec(SQL)).rejects.toThrow(/① 여기에_봇_토큰 자리에/);
    expect(await secrets()).toEqual({});
    expect(await jobs()).toEqual([]);
  });

  it("따옴표·띄어쓰기·줄바꿈이 같이 복사돼도 지우고 금고에 넣은 뒤 밤 9시(12:00 UTC)로 예약", async () => {
    const results = await db.exec(fill(` "${TOKEN}" `, `'-1001234567890'\n`));
    expect(await secrets()).toEqual({ telegram_bot_token: TOKEN, telegram_chat_id: "-1001234567890" });
    expect(await jobs()).toEqual([{ schedule: "0 12 * * *", command: "select app.send_daily_orders()" }]);
    expect(results.at(-1)?.rows[0]?.["결과"]).toContain("설정 완료");
  });

  it("다시 Run 하면 새 값으로 바꿔 쓴다 (텔레그램 주소째 붙여넣어도 토큰만 골라 씀)", async () => {
    await db.exec(fill(TOKEN, "-1001234567890"));
    const next = `9876543210:BBB${"b".repeat(32)}`;
    await db.exec(fill(`https://api.telegram.org/bot${next}/sendMessage`, "-100999999999"));
    expect(await secrets()).toEqual({ telegram_bot_token: next, telegram_chat_id: "-100999999999" });
    expect(await jobs()).toHaveLength(1);
  });

  it("토큰을 일부만 복사했거나 방 번호가 숫자가 아니면 막고 이전 값은 그대로", async () => {
    await db.exec(fill(TOKEN, "-1001234567890"));
    await expect(db.exec(fill("1234567890", "-100999999999"))).rejects.toThrow(/①/);
    await expect(db.exec(fill(TOKEN, "여기에_방_번호"))).rejects.toThrow(/② 여기에_방_번호 자리에/);
    await expect(db.exec(fill(TOKEN, "방번호"))).rejects.toThrow(/②/);
    expect(await secrets()).toEqual({ telegram_bot_token: TOKEN, telegram_chat_id: "-1001234567890" });
  });
});
