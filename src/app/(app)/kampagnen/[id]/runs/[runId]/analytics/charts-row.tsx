"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const BRAND = "#AA8CF5";
const BRAND_DEEP = "#7C5CE8";
const BRAND_SOFT = "#F3EEFF";
const AXIS = "#9ca3af";
const GRID = "#f3f3f3";

interface CtaItem {
  label: string;
  count: number;
}

interface ProgressItem {
  bucket: 25 | 50 | 75 | 100;
  count: number;
}

interface ChartsRowProps {
  opened: number;
  notOpened: number;
  progressDistribution: ProgressItem[];
  ctaBreakdown: CtaItem[];
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string; payload?: Record<string, unknown> }>;
  label?: string | number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0];
  const name = item?.payload && typeof item.payload.name === "string" ? item.payload.name : item?.name;
  return (
    <div
      className="rounded-squircle-sm bg-surface px-3 py-2 shadow-card-hover text-xs"
      style={{ minWidth: 100 }}
    >
      {label !== undefined && (
        <div className="text-ink-muted mb-0.5">{String(label)}</div>
      )}
      <div className="flex items-center gap-2">
        <span className="inline-block size-2 rounded-full" style={{ background: BRAND }} />
        <span className="text-ink font-semibold">{name}</span>
        <span className="text-ink-muted">{item.value}</span>
      </div>
    </div>
  );
}

export function ChartsRow({
  opened,
  notOpened,
  progressDistribution,
  ctaBreakdown,
}: ChartsRowProps) {
  const total = opened + notOpened;
  const pieData = [
    { name: "Geöffnet", value: opened, fill: BRAND },
    { name: "Nicht geöffnet", value: notOpened, fill: BRAND_SOFT },
  ];

  const progressData = progressDistribution.map((p) => ({
    name: `${p.bucket}%`,
    bucket: p.bucket,
    count: p.count,
  }));

  const ctaData = ctaBreakdown.map((c) => ({
    name: c.label,
    label: c.label,
    count: c.count,
  }));

  const hasOpens = total > 0;
  const hasProgress = progressData.some((p) => p.count > 0);
  const hasCta = ctaData.length > 0 && ctaData.some((c) => c.count > 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <Card>
        <CardHeader>
          <CardTitle>Öffnungs-Verteilung</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ width: "100%", height: 240 }}>
            {hasOpens ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={90}
                    stroke="#fff"
                    strokeWidth={2}
                  >
                    {pieData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "transparent" }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </div>
          <Legend
            items={[
              { name: "Geöffnet", color: BRAND, value: opened },
              { name: "Nicht geöffnet", color: BRAND_SOFT, value: notOpened },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Watch-Tiefe</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ width: "100%", height: 240 }}>
            {hasProgress ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={progressData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="name" stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: BRAND_SOFT, opacity: 0.4 }} />
                  <Bar dataKey="count" name="Leads" fill={BRAND} radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top CTAs</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ width: "100%", height: 240 }}>
            {hasCta ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={ctaData}
                  layout="vertical"
                  margin={{ top: 8, right: 16, bottom: 0, left: 8 }}
                >
                  <CartesianGrid stroke={GRID} horizontal={false} />
                  <XAxis type="number" stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    stroke={AXIS}
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={110}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: BRAND_SOFT, opacity: 0.4 }} />
                  <Bar dataKey="count" name="Klicks" fill={BRAND_DEEP} radius={[0, 8, 8, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="h-full w-full flex items-center justify-center text-sm text-ink-muted">
      Noch keine Daten
    </div>
  );
}

function Legend({ items }: { items: Array<{ name: string; color: string; value: number }> }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-4">
      {items.map((it) => (
        <div key={it.name} className="inline-flex items-center gap-2 text-xs">
          <span className="inline-block size-2.5 rounded-full" style={{ background: it.color }} />
          <span className="text-ink font-medium">{it.name}</span>
          <span className="text-ink-muted">{it.value}</span>
        </div>
      ))}
    </div>
  );
}
