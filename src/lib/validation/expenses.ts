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

export const expenseInputSchema = z.object({
  id: z.uuid().optional(),
  storeId: z.uuid({ message: "지점을 선택하세요." }),
  expenseDate: dateKey,
  categoryId: z.uuid({ message: "항목을 선택하세요." }),
  vendor: optText(60),
  vendorId: z.uuid().optional(),
  description: optText(200),
  amount: won(9_999_999_999),
  basis: z.enum(["actual", "estimated"]),
  expectedUpdatedAt: z.string().optional(),
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
    expectedUpdatedAt: s("expectedUpdatedAt") || undefined,
  };
}
