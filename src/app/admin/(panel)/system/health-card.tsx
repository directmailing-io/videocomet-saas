"use client";

import * as React from "react";
import { Heart, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HealthData {
  status: "ok" | "degraded" | "down";
  checks: Record<string, "ok" | "fail" | "skipped">;
  version?: string;
  uptimeMs?: number;
}

function formatUptime(ms?: number): string {
  if (!ms) return "–";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function HealthCard() {
  const [data, setData] = React.useState<HealthData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const fetchHealth = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const body = (await res.json()) as HealthData;
      setData(body);
    } catch {
      setError("Health-Endpoint nicht erreichbar.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchHealth();
    const t = setInterval(fetchHealth, 15000);
    return () => clearInterval(t);
  }, [fetchHealth]);

  const status = data?.status ?? "down";
  const statusVariant =
    status === "ok" ? "success" : status === "degraded" ? "warn" : "danger";
  const statusLabel =
    status === "ok"
      ? "Online"
      : status === "degraded"
      ? "Degraded"
      : "Nicht erreichbar";

  const checks = data?.checks ?? {};

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Heart className="size-4 text-ink-muted" />
          Health-Check
        </CardTitle>
        <button
          type="button"
          onClick={fetchHealth}
          className="inline-flex size-8 items-center justify-center rounded-full hover:bg-line-soft transition-colors"
          aria-label="Aktualisieren"
        >
          <RefreshCw
            className={cn(
              "size-4 text-ink-muted",
              loading && "animate-spin"
            )}
          />
        </button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <div className="rounded-squircle-sm border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">
            {error}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-sm text-ink-muted">Status</span>
              <Badge variant={statusVariant} dot>
                {statusLabel}
              </Badge>
            </div>
            <div className="border-t border-line pt-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
                Checks
              </p>
              <ul className="space-y-2">
                {Object.entries(checks).map(([name, state]) => (
                  <li
                    key={name}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="capitalize text-ink">{name}</span>
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "size-2.5 rounded-full",
                          state === "ok" && "bg-ok",
                          state === "fail" && "bg-danger",
                          state === "skipped" && "bg-ink-muted",
                        )}
                      />
                      <span className="text-xs text-ink-muted font-mono">
                        {state}
                      </span>
                    </span>
                  </li>
                ))}
                {Object.keys(checks).length === 0 && (
                  <li className="text-sm text-ink-muted">Keine Checks verfügbar.</li>
                )}
              </ul>
            </div>
            <div className="border-t border-line pt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-ink-muted">Version</p>
                <p className="font-mono text-ink">{data?.version ?? "–"}</p>
              </div>
              <div>
                <p className="text-xs text-ink-muted">Uptime</p>
                <p className="font-mono text-ink">{formatUptime(data?.uptimeMs)}</p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
