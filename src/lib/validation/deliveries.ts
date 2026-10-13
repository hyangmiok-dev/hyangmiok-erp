import { z } from "zod";
import { isDateKey } from "@/lib/period";

const deliveryLineSchema = z.object({
  itemName: z
    .string()
    .trim()
    .min(1, "품목 이름을 입력하세요.")
    .max(60, "품목 이름은 60자 이하로 입력하세요.")
    .refine((v) => v !== "부가세", "부가세는 아래 '부가세' 칸에 넣어 주세요."),
  quantity: z
    .string()
    .trim()
    .refine((v) => /^\d{1,9}(\.\d{1,3})?$/.test(v), "수량은 숫자로 입력하세요 (소수점 3자리까지).")
    .refine((v) => Number(v) > 0, "수량은 0보다 커야 합니다."),
  unit: z
    .string()
    .trim()
    .max(10, "단위는 10자 이하로 입력하세요.")
    .transform((v) => v || null),
  unitPrice: z
    .string()
    .trim()
    .refine((v) => /^\d{1,9}$/.test(v), "단가를 숫자로 입력하세요."),
});

/** 입고 빠른 입력 (금액은 수량×단가로 DB 가 계산) */
export const deliveryInputSchema = z.object({
  storeId: z.uuid({ message: "지점을 고르세요." }),
  vendorId: z.uuid({ message: "거래처를 고르세요." }),
  date: z.string().refine(isDateKey, "날짜가 올바르지 않습니다."),
  lines: z.array(deliveryLineSchema).min(1, "받은 품목의 수량을 넣어 주세요.").max(49, "품목은 49줄까지 입력할 수 있습니다."),
  vat: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{1,9}$/.test(v), "부가세는 숫자로 입력하세요.")
    .transform((v) => (v === "" ? 0 : Number(v))),
  onCredit: z.boolean(),
  memo: z
    .string()
    .trim()
    .max(200, "메모는 200자 이하로 입력하세요.")
    .transform((v) => v || null),
});

export type DeliveryInput = z.input<typeof deliveryInputSchema>;
