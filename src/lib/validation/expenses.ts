import { z } from "zod";
import { isDateKey } from "@/lib/period";

const won = (max: number, min = 1) =>
  z
    .string()
    .transform((v) => Number(v.replace(/[,\s원]/g, "") || "NaN"))
    .pipe(
      z
        .number({ message: "금액을 숫자로 입력하세요." })
        .int("원 단위 정수로 입력하세요.")
        .min(min, min === 0 ? "0 이상으로 입력하세요." : "금액을 입력하세요.")
        .max(max, "금액이 너무 큽니다."),
    );

const dateKey = z.string().refine(isDateKey, "날짜가 올바르지 않습니다.");
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `${max}자 이하로 입력하세요.`)
    .transform((v) => v || null);

/** 거래명세표 품목 한 줄 (금액은 부가세 포함) */
export const expenseLineSchema = z.object({
  itemName: z.string().trim().min(1, "품목 이름을 입력하세요.").max(60, "품목 이름은 60자 이하로 입력하세요."),
  quantity: z
    .string()
    .trim()
    .refine((v) => /^\d{1,9}(\.\d{1,3})?$/.test(v.replace(/,/g, "")), "수량은 숫자로 입력하세요 (소수점 3자리까지).")
    .transform((v) => Number(v.replace(/,/g, "")))
    .refine((v) => v > 0, "수량은 0보다 커야 합니다."),
  unit: optText(10),
  unitPrice: won(999_999_999, 0),
  amount: won(9_999_999_999, 0),
});

export type ExpenseLineInput = z.output<typeof expenseLineSchema>;

const expenseBaseSchema = z.object({
  id: z.uuid().optional(),
  storeId: z.uuid({ message: "지점을 선택하세요." }),
  expenseDate: dateKey,
  categoryId: z.uuid({ message: "항목을 선택하세요." }),
  vendor: optText(60),
  vendorId: z.uuid().optional(),
  description: optText(200),
  amount: won(9_999_999_999),
  basis: z.enum(["actual", "estimated"]),
  onCredit: z.boolean(),
  lines: z.array(expenseLineSchema).max(50, "품목은 50줄까지 입력할 수 있습니다."),
  expectedUpdatedAt: z.string().optional(),
});

/** 품목이 있으면 지출 금액 = 품목 금액 합계 (서버에서 다시 계산) */
export const expenseInputSchema = z
  .preprocess((raw) => {
    const r = raw as Record<string, unknown>;
    const lines = Array.isArray(r.lines) ? (r.lines as { amount?: string }[]) : [];
    if (!lines.length) return r;
    const sum = lines.reduce((n, l) => n + (Number(String(l.amount ?? "").replace(/[,\s원]/g, "")) || 0), 0);
    return { ...r, amount: String(sum) };
  }, expenseBaseSchema)
  .superRefine((v, ctx) => {
    if (v.onCredit && !v.vendor) {
      ctx.addIssue({ code: "custom", path: ["vendor"], message: "외상(미수)은 거래처를 골라야 기록할 수 있어요." });
    }
  });

export const inventoryInputSchema = z.object({
  storeId: z.uuid(),
  countDate: dateKey,
  amount: won(9_999_999_999, 0),
  memo: optText(200),
});

export function expenseFormToObject(fd: FormData) {
  const s = (k: string) => (fd.get(k) as string | null) ?? "";
  return {
    id: s("id") || undefined,
    storeId: s("storeId"),
    expenseDate: s("expenseDate"),
    categoryId: s("categoryId"),
    vendor: s("vendor"),
    vendorId: s("vendorId") || undefined,
    description: s("description"),
    amount: s("amount"),
    basis: s("basis") || "actual",
    onCredit: fd.get("onCredit") === "on",
    lines: parseLines(s("lines")),
    expectedUpdatedAt: s("expectedUpdatedAt") || undefined,
  };
}

function parseLines(raw: string): unknown {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return "invalid";
  }
}
