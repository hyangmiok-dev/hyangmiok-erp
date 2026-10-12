import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/dal";
import { listAccessibleStores } from "@/lib/data/stores";
import { listSales } from "@/lib/data/sales";
import { resolvePeriod } from "@/lib/period";
import { seoulDateKey, formatDateTimeKo } from "@/lib/format";
import { toCsv } from "@/lib/sales/csv";

const SOURCE = { manual: "직접 입력", csv: "CSV", pos: "POS" } as const;

/** 매출 CSV 내려받기 (엑셀에서 바로 열림). 데이터 범위는 RLS 가 결정한다. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.mustChangePassword) return new NextResponse("로그인이 필요합니다.", { status: 401 });
  if (user.role === "staff") return new NextResponse("권한이 없습니다.", { status: 403 });

  const sp = req.nextUrl.searchParams;
  const range = resolvePeriod("custom", seoulDateKey(), {
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
  });
  const storeParam = sp.get("store");

  const stores = await listAccessibleStores();
  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const sales = await listSales(range, storeParam && storeParam !== "all" ? [storeParam] : undefined);

  const csv = toCsv([
    ["날짜", "지점", "실매출", "건수", "휴무", "메모", "입력방법", "최종 입력자", "최종 입력시각"],
    ...sales.map((s) => [
      s.date,
      storeName.get(s.storeId) ?? s.storeId,
      s.netSales,
      s.orderCount,
      s.isClosed ? "휴무" : "",
      s.memo,
      SOURCE[s.source],
      s.updatedByName,
      formatDateTimeKo(s.updatedAt),
    ]),
  ]);

  const fileName = `향미옥_매출_${range.start}_${range.end}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sales.csv"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
