import { z } from "zod";
import { isDateKey } from "@/lib/period";

/** 전표 입력 저장: 바뀐 칸만 [{거래처, 금액}] — 0 이면 그 날 그 거래처 전표를 지운다 (DB save_slips 가 다시 검사) */
export const slipsInputSchema = z.object({
  storeId: z.uuid({ message: "지점을 고르세요." }),
  date: z.string().refine(isDateKey, "날짜가 올바르지 않습니다."),
  entries: z
    .array(
      z.object({
        vendorId: z.uuid({ message: "거래처가 올바르지 않습니다." }),
        amount: z
          .number()
          .int("금액은 원 단위 숫자로 적어 주세요.")
          .min(0, "금액은 0원 이상이어야 합니다.")
          .max(9_999_999_999, "금액이 너무 큽니다."),
      }),
    )
    .min(1, "바뀐 금액이 없어요.")
    .max(60, "한 번에 60곳까지 저장할 수 있습니다.")
    .refine((es) => new Set(es.map((e) => e.vendorId)).size === es.length, "같은 거래처가 두 번 들어 있습니다."),
});

export type SlipsInput = z.input<typeof slipsInputSchema>;
