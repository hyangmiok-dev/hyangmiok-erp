import { z } from "zod";
import { isDateKey } from "@/lib/period";
import { isPhotoPathOf } from "@/lib/statements";
import { expenseLineSchema } from "@/lib/validation/expenses";

const won = (max: number, msg: string) =>
  z
    .string()
    .transform((v) => v.replace(/[,\s원]/g, ""))
    .refine((v) => /^-?\d{1,10}$/.test(v), msg)
    .transform(Number)
    .refine((v) => Math.abs(v) <= max, "금액이 너무 큽니다.");

/** 사진을 보관함에 올린 뒤 기록 만들기 */
export const createStatementSchema = z
  .object({
    storeId: z.uuid({ message: "지점을 고르세요." }),
    vendorId: z.uuid({ message: "거래처를 고르세요." }),
    photoPath: z.string().max(120),
    photoBytes: z.number().int().min(1).max(5 * 1024 * 1024, "사진이 너무 큽니다."),
  })
  .refine((v) => isPhotoPathOf(v.storeId, v.photoPath), { path: ["photoPath"], message: "사진 경로가 올바르지 않습니다." });

/** 확인 후 확정 */
export const confirmStatementSchema = z.object({
  statementId: z.uuid(),
  date: z.string().refine(isDateKey, "날짜가 올바르지 않습니다."),
  lines: z.array(expenseLineSchema).min(1, "품목을 한 줄 이상 적어 주세요.").max(49, "품목은 49줄까지 입력할 수 있습니다."),
  vat: won(9_999_999_999, "부가세는 숫자로 적어 주세요.").refine((v) => v >= 0, "부가세는 0 이상이어야 합니다."),
  onCredit: z.boolean(),
  statementTotal: z
    .string()
    .transform((v) => v.replace(/[,\s원]/g, ""))
    .refine((v) => v === "" || /^\d{1,10}$/.test(v), "명세표 합계는 숫자로 적어 주세요.")
    .transform((v) => (v === "" ? null : Number(v))),
  statementBalance: z
    .string()
    .transform((v) => v.replace(/[,\s원]/g, ""))
    .refine((v) => v === "" || /^-?\d{1,10}$/.test(v), "잔액은 숫자로 적어 주세요.")
    .transform((v) => (v === "" ? null : Number(v))),
  memo: z
    .string()
    .trim()
    .max(200, "메모는 200자 이하로 적어 주세요.")
    .transform((v) => v || null),
  checked: z.literal(true, { message: "사진과 한 줄씩 비교한 뒤 '확인했어요'에 체크해 주세요." }),
});

export type ConfirmStatementInput = z.output<typeof confirmStatementSchema>;

export function confirmFormToObject(fd: FormData) {
  const s = (k: string) => (fd.get(k) as string | null) ?? "";
  let lines: unknown = [];
  try {
    lines = JSON.parse(s("lines") || "[]");
  } catch {
    lines = "invalid";
  }
  return {
    statementId: s("statementId"),
    date: s("date"),
    lines,
    vat: s("vat") || "0",
    onCredit: fd.get("onCredit") === "on",
    statementTotal: s("statementTotal"),
    statementBalance: s("statementBalance"),
    memo: s("memo"),
    checked: fd.get("checked") === "on",
  };
}
