import { z } from "zod";
import { isDateKey } from "@/lib/period";

const MAX_WON = 99_999_999_999;

/** '1,234,000' → 1234000 (서버에서도 콤마 제거 후 정수 검증) */
const wonField = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? v : Number(v.replace(/[,\s원]/g, "") || "NaN")))
  .pipe(
    z
      .number({ message: "숫자를 입력하세요." })
      .int("원 단위 정수로 입력하세요.")
      .min(0, "0 이상으로 입력하세요.")
      .max(MAX_WON, "금액이 너무 큽니다."),
  );

const countField = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? v : Number(v.replace(/[,\s건]/g, "") || "NaN")))
  .pipe(z.number({ message: "숫자를 입력하세요." }).int("정수로 입력하세요.").min(0, "0 이상으로 입력하세요.").max(99_999));

const dateKey = z.string().refine(isDateKey, "날짜가 올바르지 않습니다.");

export const saleInputSchema = z
  .object({
    storeId: z.uuid({ message: "지점을 선택하세요." }),
    businessDate: dateKey,
    isClosed: z.boolean(),
    netSales: wonField.optional(),
    orderCount: countField.optional(),
    memo: z
      .string()
      .trim()
      .max(500, "메모는 500자 이하로 입력하세요.")
      .optional()
      .transform((v) => v || null),
    /** 수정 시: 화면을 연 시점의 updated_at (동시 수정 감지) */
    expectedUpdatedAt: z.string().optional(),
  })
  .transform((v) => ({
    ...v,
    netSales: v.isClosed ? 0 : v.netSales,
    orderCount: v.isClosed ? 0 : v.orderCount,
  }))
  .superRefine((v, ctx) => {
    if (v.netSales === undefined) ctx.addIssue({ code: "custom", path: ["netSales"], message: "실매출을 입력하세요." });
    if (v.orderCount === undefined) ctx.addIssue({ code: "custom", path: ["orderCount"], message: "건수를 입력하세요." });
  });

export type SaleInput = z.output<typeof saleInputSchema>;

export const importRowSchema = z.object({
  store_id: z.uuid(),
  business_date: dateKey,
  net_sales: z.number().int().min(0).max(MAX_WON),
  order_count: z.number().int().min(0).max(99_999),
  is_closed: z.boolean(),
  memo: z.string().max(500).nullable(),
});

export const importPayloadSchema = z.object({
  fileName: z.string().max(200),
  overwrite: z.boolean(),
  rows: z.array(importRowSchema).min(1, "등록할 행이 없습니다.").max(2000, "한 번에 2000행까지 등록할 수 있습니다."),
});

export function saleFormToObject(fd: FormData) {
  return {
    storeId: fd.get("storeId") ?? undefined,
    businessDate: fd.get("businessDate") ?? undefined,
    isClosed: fd.get("isClosed") === "on",
    netSales: (fd.get("netSales") as string | null) || undefined,
    orderCount: (fd.get("orderCount") as string | null) || undefined,
    memo: (fd.get("memo") as string | null) ?? undefined,
    expectedUpdatedAt: (fd.get("expectedUpdatedAt") as string | null) || undefined,
  };
}
