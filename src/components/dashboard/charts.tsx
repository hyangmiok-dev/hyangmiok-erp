"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** 지점은 정렬 순서에 따라 고정 색을 갖는다 (필터해도 색이 바뀌지 않음). 4개 이상이면 회색. */
export function seriesColor(slot: number): string {
  return slot >= 1 && slot <= 3 ? `var(--series-${slot})` : "var(--chart-axis)";
}

export interface ChartStore {
  id: string;
  name: string;
  slot: number;
}

const won = (v: number) => `${v.toLocaleString("ko-KR")}원`;
const compactWon = (v: number) =>
  v >= 100_000_000 ? `${Math.round(v / 10_000_000) / 10}억` : v >= 10_000 ? `${Math.round(v / 10_000).toLocaleString("ko-KR")}만` : `${v}`;

const axisProps = {
  stroke: "var(--chart-axis)",
  fontSize: 12,
  tickLine: false,
  axisLine: { stroke: "var(--chart-grid)" },
} as const;

const tooltipStyle = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--popover)",
    color: "var(--popover-foreground)",
    fontSize: 13,
  },
  labelStyle: { fontWeight: 600, marginBottom: 4 },
} as const;

/** 지점별 매출 막대 (가로) */
export function StoreBarChart({ data }: { data: { name: string; slot: number; value: number }[] }) {
  const height = Math.max(120, data.length * 56 + 24);
  return (
    <div style={{ height }} role="img" aria-label="지점별 매출 막대 그래프 (아래 표와 같은 값)">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 8 }} barCategoryGap={12}>
          <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
          <XAxis type="number" {...axisProps} tickFormatter={compactWon} />
          <YAxis type="category" dataKey="name" {...axisProps} width={96} />
          <Tooltip {...tooltipStyle} cursor={{ fill: "var(--muted)" }} formatter={(v) => [won(Number(v)), "실매출"]} />
          <Bar
            dataKey="value"
            radius={[0, 4, 4, 0]}
            maxBarSize={28}
            label={{ position: "right", fontSize: 12, fill: "var(--foreground)", formatter: (v: unknown) => compactWon(Number(v)) }}
            shape={(props: unknown) => {
              const p = props as { x: number; y: number; width: number; height: number; payload: { slot: number } };
              return (
                <rect
                  x={p.x}
                  y={p.y}
                  width={Math.max(0, p.width)}
                  height={p.height}
                  rx={4}
                  fill={seriesColor(p.payload.slot)}
                />
              );
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 일별 매출 추이 (지점별 선). 미입력일은 끊어서 표시 (0 으로 그리지 않음) */
export function TrendLineChart({
  data,
  stores,
}: {
  data: ({ date: string; label: string } & Record<string, number | null | string>)[];
  stores: ChartStore[];
}) {
  return (
    <div className="h-72" role="img" aria-label="일별 매출 추이 그래프 (미입력일은 선이 끊김)">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" {...axisProps} minTickGap={16} />
          <YAxis {...axisProps} tickFormatter={compactWon} width={56} />
          <Tooltip
            {...tooltipStyle}
            cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }}
            formatter={(v, name) => [v === null || v === undefined ? "미입력" : won(Number(v)), String(name)]}
          />
          {stores.length > 1 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />}
          {stores.map((s) => (
            <Line
              key={s.id}
              type="monotone"
              dataKey={s.id}
              name={s.name}
              stroke={seriesColor(s.slot)}
              strokeWidth={2}
              dot={data.length <= 14 ? { r: 3, strokeWidth: 0, fill: seriesColor(s.slot) } : false}
              activeDot={{ r: 5, stroke: "var(--background)", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
