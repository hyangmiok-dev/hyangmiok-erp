/**
 * 지출 항목 오입력 방지: 거래처·내용에 들어간 단어로 맞는 항목을 추측한다.
 * (실제 사례: 거래처에 '임대료'라고 쓰고 항목은 기본값 '식재료비'로 저장)
 */
const KEYWORDS: Record<string, string[]> = {
  rent: ["월세", "임대료", "임대"],
  maintenance: ["관리비"],
  utilities: ["전기", "한전", "도시가스", "가스비", "수도", "물세", "상하수도"],
  labor_wage: ["급여", "월급", "알바", "아르바이트", "인건비"],
  labor_ins: ["4대보험", "건강보험", "국민연금", "고용보험", "산재"],
  advertising: ["광고", "마케팅", "리뷰", "인스타", "릴스"],
  card_fee: ["카드사", "카드수수료", "단말기"],
  delivery_fee: ["배민", "배달의민족", "쿠팡이츠", "요기요", "배달대행"],
  services: ["세무", "회계", "노무", "세스코", "텔레캅", "캡스", "통신"],
  repairs: ["수리", "수선", "as"],
  tax: ["부가세", "원천세", "법인세", "국세", "지방세"],
  finance: ["이자", "대출", "할부"],
  capital: ["보증금", "권리금"],
};

/** 텍스트에서 추측한 항목 code. 여러 개면 가장 긴 단어가 맞은 것 */
export function guessCategoryCode(text: string): { code: string; word: string } | null {
  const t = text.replace(/\s+/g, "").toLowerCase();
  if (!t) return null;
  let best: { code: string; word: string } | null = null;
  for (const [code, words] of Object.entries(KEYWORDS)) {
    for (const w of words) {
      if (t.includes(w) && (!best || w.length > best.word.length)) best = { code, word: w };
    }
  }
  return best;
}
