import { z } from "zod";
import { isDateKey } from "@/lib/period";

export const paymentInputSchema = z.object({
  id: z.uuid().optional(),
  storeId: z.uuid({ message: "지점을 선택하세요." }),
  vendorId: z.uuid({ message: "거래처를 선택하세요." }),
  paidDate: z.string().refine(isDateKey, "날짜가 올바르지 않습니다."),
  kind: z.enum(["payment", "opening"]),
  amount: z
    .string()
    .transform((v) => Number(v.replace(/[,\s원]/g, "") || "NaN"))
    .pipe(
      z
        .number({ message: "금액을 숫자로 입력하세요." })
        .int("원 단위 정수로 입력하세요.")
        .min(1, "금액을 입력하세요.")
        .max(9_999_999_999, "금액이 너무 큽니다."),
    ),
  method: z
    .string()
    .transform((v) => v || null)
    .pipe(z.enum(["transfer", "card", "cash", "other"]).nullable()),
  memo: z
    .string()
    .trim()
    .max(200, "메모는 200자 이하로 입력하세요.")
    .transform((v) => v || null),
  expectedUpdatedAt: z.string().optional(),
});

export function paymentFormToObject(fd: FormData) {
  const s = (k: string) => String(fd.get(k) ?? "");
  return {
    id: s("id") || undefined,
    storeId: s("storeId"),
    vendorId: s("vendorId"),
    paidDate: s("paidDate"),
    kind: s("kind") || "payment",
    amount: s("amount"),
    method: s("method"),
    memo: s("memo"),
    expectedUpdatedAt: s("expectedUpdatedAt") || undefined,
  };
}
