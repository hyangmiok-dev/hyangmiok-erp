import { z } from "zod";

const optText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label}은(는) ${max}자 이하로 입력하세요.`)
    .transform((v) => v || null);

export const vendorInputSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "거래처 이름을 입력하세요.").max(60, "이름은 60자 이하로 입력하세요."),
  items: optText(200, "주요 품목"),
  defaultCategoryId: z
    .string()
    .transform((v) => v || null)
    .pipe(z.uuid({ message: "기본 항목이 올바르지 않습니다." }).nullable()),
  contactName: optText(30, "담당자"),
  phone: z
    .string()
    .trim()
    .max(30, "전화번호는 30자 이하로 입력하세요.")
    .refine((v) => v === "" || /^[0-9+\-()\s]+$/.test(v), "전화번호는 숫자와 - 만 입력하세요.")
    .transform((v) => v || null),
  memo: optText(500, "메모"),
  isActive: z.boolean(),
  storeIds: z.array(z.uuid()).max(50),
});

export type VendorInput = z.output<typeof vendorInputSchema>;

export function vendorFormToObject(fd: FormData) {
  const s = (k: string) => String(fd.get(k) ?? "");
  return {
    id: s("id") || undefined,
    name: s("name"),
    items: s("items"),
    defaultCategoryId: s("defaultCategoryId"),
    contactName: s("contactName"),
    phone: s("phone"),
    memo: s("memo"),
    isActive: fd.get("isActive") === "on",
    storeIds: fd.getAll("storeIds").map(String),
  };
}
