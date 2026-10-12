/**
 * 거래명세표 AI 읽기 — 결과 형식(구조화 출력)과 지시문.
 * Edge Function(Deno)과 Next.js 앱(검토 화면, src/lib/statements.ts)이 함께 쓴다.
 * 여기에는 Deno 전용 코드를 넣지 않는다.
 */
import { z } from "zod";

/** 대표 결정 2026-10-13: 가장 정확한 모델 */
export const MODEL = "claude-opus-5-5";

export const LINE_FIELDS = ["name", "quantity", "unit", "unit_price", "amount", "tax"] as const;
export const HEAD_FIELDS = ["vendor_name", "date", "total", "previous_balance", "balance"] as const;
export type LineField = (typeof LINE_FIELDS)[number];
export type HeadField = (typeof HEAD_FIELDS)[number];

export const StatementLine = z.object({
  name: z.string().nullable().describe("품목명. 규격이 따로 적혀 있으면 뒤에 괄호로 붙인다 (예: 차돌양지 (1kg))"),
  quantity: z.number().nullable().describe("수량"),
  unit: z.string().nullable().describe("단위 (kg, 박스, 개, EA 등). 없으면 null"),
  unit_price: z.number().nullable().describe("단가 — 적힌 그대로"),
  amount: z.number().nullable().describe("그 줄의 금액(공급가액) — 적힌 그대로, 세액 제외"),
  tax: z.number().nullable().describe("그 줄의 세액(부가세). 세액 칸이 없거나 비어 있으면 null"),
  unclear: z.array(z.enum(LINE_FIELDS)).describe("흐리거나 가려져 확실하지 않은 칸 이름"),
});

export const StatementRead = z.object({
  is_statement: z.boolean().describe("거래명세표·납품서·영수증 사진이면 true"),
  vendor_name: z.string().nullable().describe("공급자(파는 쪽) 상호"),
  date: z.string().nullable().describe("거래 날짜 YYYY-MM-DD"),
  lines: z.array(StatementLine).describe("품목 줄 (사진 순서대로)"),
  supply_total: z.number().nullable().describe("공급가액 합계"),
  tax_total: z.number().nullable().describe("세액(부가세) 합계"),
  total: z.number().nullable().describe("이번 거래 합계 금액 (부가세 포함)"),
  previous_balance: z.number().nullable().describe("전잔액 (이번 거래 전 미수)"),
  balance: z.number().nullable().describe("잔액·미수 합계 (이번 거래 포함)"),
  unclear: z.array(z.enum(HEAD_FIELDS)).describe("확실하지 않은 항목 이름"),
  notes: z.string().nullable().describe("사람이 확인할 점을 한국어 한두 문장으로 (흐림, 잘림, 손글씨 수정, 반품 등). 없으면 null"),
});
export type StatementRead = z.infer<typeof StatementRead>;
export type StatementLine = z.infer<typeof StatementLine>;

export function systemPrompt(today: string): string {
  return [
    "당신은 한국 식당(쌀국수 가게)이 거래처에서 받은 거래명세표 사진을 읽어 표로 옮기는 일을 합니다.",
    `오늘 날짜는 ${today} (한국 시간)입니다.`,
    "",
    "규칙:",
    "1. 사진에 실제로 보이는 글자와 숫자만 옮깁니다. 흐리거나 가려지거나 잘려서 읽을 수 없는 값은 추측하지 말고 null 로 두고, 그 칸 이름을 unclear 에 넣습니다. 읽었지만 확신이 낮은 값도 unclear 에 넣습니다.",
    "2. 품목 한 줄은 lines 의 한 항목입니다. 빈 줄, 소계·합계 줄, '이하 여백', 도장·서명은 넣지 않습니다. 순서는 사진 순서대로.",
    "3. 숫자는 쉼표 없이 숫자로 적습니다. 금액은 원 단위입니다. 수량은 소수일 수 있습니다 (예: 1.5).",
    "4. amount 는 그 줄의 금액(공급가액) 칸 값 그대로, tax 는 세액 칸 값 그대로입니다. 금액 칸이 하나뿐이면 그 값을 amount 에 넣고 tax 는 null 입니다. 적혀 있지 않은 값을 계산해서 채우지 않습니다.",
    "5. 손글씨로 고친 숫자는 고친 뒤의 값을 쓰고 notes 에 알립니다. 반품·마이너스 줄은 lines 에 넣지 말고 notes 에 적습니다.",
    "6. 합계·전잔액·잔액(미수)은 명세표에 적힌 값만 씁니다. 없으면 null.",
    "7. 날짜는 YYYY-MM-DD 로 씁니다. 연도가 안 적혀 있으면 오늘 이전의 가장 가까운 날짜로 하고 unclear 에 date 를 넣습니다.",
    "8. 거래명세표·영수증이 아닌 사진이면 is_statement 를 false 로 하고 lines 는 비웁니다.",
  ].join("\n");
}

export function userPrompt(vendorName: string): string {
  return `올린 사람이 거래처로 '${vendorName}'을(를) 골랐습니다. 이 거래명세표를 규칙대로 읽어 주세요.`;
}
