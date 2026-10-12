/** 지점은 정렬 순서에 따라 고정 색을 갖는다 (필터해도 색이 바뀌지 않음). 4개 이상이면 회색.
 *  서버·클라이언트 컴포넌트 양쪽에서 쓰므로 "use client" 파일에 두지 않는다. */
export function seriesColor(slot: number): string {
  return slot >= 1 && slot <= 3 ? `var(--series-${slot})` : "var(--chart-axis)";
}
