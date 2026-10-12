import { z } from "zod";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 운영시간 (stores.business_hours jsonb). 모르는 값은 비워둔다. */
export const businessHoursSchema = z
  .object({
    open: z.string().regex(TIME).nullable(),
    close: z.string().regex(TIME).nullable(),
    breakStart: z.string().regex(TIME).nullable(),
    breakEnd: z.string().regex(TIME).nullable(),
    closedWeekdays: z.array(z.number().int().min(0).max(6)).max(7),
  })
  .partial();

export type BusinessHours = z.infer<typeof businessHoursSchema>;

const optionalText = (max: number, msg: string) =>
  z
    .string()
    .trim()
    .max(max, msg)
    .transform((v) => v || null);

const optionalTime = z
  .string()
  .trim()
  .refine((v) => v === "" || TIME.test(v), "시간은 09:30 형식으로 입력하세요.")
  .transform((v) => v || null);

export const storeUpdateSchema = z
  .object({
    storeId: z.uuid(),
    name: z.string().trim().min(1, "지점 이름을 입력하세요.").max(50, "50자 이하로 입력하세요."),
    address: optionalText(200, "주소는 200자 이하로 입력하세요."),
    seatCount: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d{1,4}$/.test(v), "좌석 수는 숫자로 입력하세요.")
      .transform((v) => (v === "" ? null : Number(v)))
      .refine((v) => v === null || v <= 1000, "좌석 수가 너무 큽니다."),
    areaPyeong: z
      .string()
      .trim()
      .refine((v) => v === "" || /^\d{1,4}(\.\d)?$/.test(v), "면적은 숫자로 입력하세요 (예: 22 또는 22.5).")
      .transform((v) => (v === "" ? null : Number(v)))
      .refine((v) => v === null || v > 0, "면적은 0보다 커야 합니다."),
    open: optionalTime,
    close: optionalTime,
    breakStart: optionalTime,
    breakEnd: optionalTime,
    closedWeekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7),
    notes: optionalText(1000, "메모는 1000자 이하로 입력하세요."),
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if ((v.open === null) !== (v.close === null)) {
      ctx.addIssue({ code: "custom", path: ["open"], message: "영업 시작·종료 시간을 둘 다 입력하거나 둘 다 비워두세요." });
    }
    if ((v.breakStart === null) !== (v.breakEnd === null)) {
      ctx.addIssue({ code: "custom", path: ["breakStart"], message: "브레이크 시작·종료를 둘 다 입력하거나 둘 다 비워두세요." });
    }
  });

export function storeFormToObject(fd: FormData) {
  const s = (k: string) => String(fd.get(k) ?? "");
  return {
    storeId: s("storeId"),
    name: s("name"),
    address: s("address"),
    seatCount: s("seatCount"),
    areaPyeong: s("areaPyeong"),
    open: s("open"),
    close: s("close"),
    breakStart: s("breakStart"),
    breakEnd: s("breakEnd"),
    closedWeekdays: fd.getAll("closedWeekdays").map(String),
    notes: s("notes"),
    isActive: fd.get("isActive") === "on",
  };
}

/** 영업시간으로 주간 운영시간 계산 (KPI: 좌석·시간당 매출용). 정보가 없으면 null. */
export function weeklyOperatingHours(h: BusinessHours | null | undefined): number | null {
  if (!h?.open || !h.close) return null;
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  let daily = toMin(h.close) - toMin(h.open);
  if (daily <= 0) daily += 24 * 60; // 자정 넘어 영업
  if (h.breakStart && h.breakEnd) daily -= Math.max(0, toMin(h.breakEnd) - toMin(h.breakStart));
  const days = 7 - (h.closedWeekdays?.length ?? 0);
  return Math.round(((daily * days) / 60) * 10) / 10;
}
