// Supabase 연결·마이그레이션·보안 상태 점검 (읽기 전용, 데이터 변경 없음)
// 실행: node --env-file=.env.local scripts/verify-supabase.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;

let failed = 0;
const ok = (msg) => console.log(`  ✅ ${msg}`);
const bad = (msg) => {
  failed++;
  console.log(`  ❌ ${msg}`);
};

console.log("1) 관리자 키로 연결 + 마이그레이션 확인");
const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: stores, error: sErr } = await admin.from("stores").select("code, name, seat_count").order("code");
if (sErr) bad(`지점 조회 실패: ${sErr.message}`);
else if (stores.length === 3) ok(`지점 3개: ${stores.map((s) => s.name).join(", ")}`);
else bad(`지점 수가 3이 아님: ${stores.length}`);

const { data: owners, error: oErr } = await admin
  .from("profiles")
  .select("full_name, role, is_active, email")
  .eq("role", "owner");
if (oErr) bad(`프로필 조회 실패: ${oErr.message}`);
else {
  const active = owners.filter((o) => o.is_active);
  if (active.length >= 1) ok(`활성 대표 계정 ${active.length}개`);
  else bad("활성 대표 계정이 없음 → bootstrap-owner.sql 확인");
}

const { error: colErr } = await admin.from("profiles").select("must_change_password").limit(1);
if (colErr) bad(`1단계 보완 마이그레이션(20261013000100) 미적용: ${colErr.message}`);
else ok("1단계 보완 마이그레이션 적용됨 (이름 아이디·첫 비밀번호 변경)");

const { error: salesErr } = await admin.from("daily_sales").select("id").limit(1);
if (salesErr) bad(`2단계 마이그레이션(20261013000200 매출) 미적용: ${salesErr.message}`);
else ok("2단계 마이그레이션 적용됨 (일별 매출)");

const { data: cats, error: catErr } = await admin.from("expense_categories").select("id");
if (catErr) bad(`3단계 마이그레이션(20261013000300 지출) 미적용: ${catErr.message}`);
else ok(`3단계 마이그레이션 적용됨 (지출 항목 ${cats.length}개)`);

const { data: vend, error: vendErr } = await admin.from("vendors").select("id");
if (vendErr) bad(`거래처 마이그레이션(20261013000400) 미적용: ${vendErr.message}`);
else ok(`거래처 마이그레이션 적용됨 (거래처 ${vend.length}곳)`);

const { error: ledErr } = await admin.from("vendor_payments").select("id").limit(1);
if (ledErr) bad(`거래처 원장 마이그레이션(20261013000500) 미적용: ${ledErr.message}`);
else ok("거래처 원장 마이그레이션 적용됨 (품목·미수)");

const { data: reserve, error: resErr } = await admin.from("stores").select("name, stock_reserve_pct").order("code");
if (resErr) bad(`냉장고 재고 비율 마이그레이션(20261013000600) 미적용: ${resErr.message}`);
else ok(`냉장고 재고 비율 적용됨 (${reserve.map((s) => `${s.name.replace("향미옥 ", "")} ${Number(s.stock_reserve_pct)}%`).join(", ")})`);

const { data: allProfiles } = await admin.from("profiles").select("role, is_active");
const { data: authUsers } = await admin.auth.admin.listUsers({ perPage: 200 });
ok(`Auth 사용자 ${authUsers?.users?.length ?? "?"}명 / 프로필 ${allProfiles?.length ?? "?"}개`);

console.log("2) 비로그인(공개 키)으로는 데이터가 차단되는지");
const anon = createClient(url, pub, { auth: { persistSession: false } });
for (const table of ["stores", "profiles", "store_members", "audit_logs", "daily_sales", "import_batches", "expenses", "expense_categories", "inventory_counts", "vendors", "vendor_stores", "expense_lines", "vendor_payments"]) {
  const { data, error } = await anon.from(table).select("*").limit(1);
  if (error || (data ?? []).length === 0) ok(`${table}: 차단됨${error ? ` (${error.code ?? error.message})` : " (0행)"}`);
  else bad(`${table}: 비로그인 상태에서 데이터가 보임!`);
}
const { error: rpcErr } = await anon.rpc("set_store_memberships", { p_user_id: null, p_store_ids: [] });
if (rpcErr) ok(`set_store_memberships: 비로그인 실행 차단 (${rpcErr.code ?? rpcErr.message})`);
else bad("set_store_memberships: 비로그인 실행이 허용됨!");

console.log("3) 공개 회원가입이 꺼져 있는지");
const probe = `signup-probe-${Date.now()}@example.com`;
const { data: su, error: suErr } = await anon.auth.signUp({ email: probe, password: `Probe-${Date.now()}x9` });
if (suErr) ok(`회원가입 차단됨 (${suErr.message})`);
else {
  bad("누구나 회원가입 가능! Authentication → Sign In/Providers 에서 'Allow new users to sign up' 끄기");
  if (su.user?.id) await admin.auth.admin.deleteUser(su.user.id); // 점검용 계정 즉시 삭제
}

console.log(failed ? `\n결과: 문제 ${failed}건` : "\n결과: 모두 정상");
process.exit(failed ? 1 : 0);
