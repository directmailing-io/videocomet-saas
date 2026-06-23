"use client";

import * as React from "react";
import { Calculator, Check, Mail, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { RevealOnScroll } from "./RevealOnScroll";

const BASE_FEE = 70;
const PER_SEND_COST = 1;
// DIN Lang: 0,95 € Porto + 1 € Druck
const DIN_LANG_COST = 0.95 + 1;
// DIN C4:   1,80 € Porto + 1 € Druck
const DIN_C4_COST = 1.8 + 1;

// Conversion-Quoten — Durchschnitts-Case, kein Best-Case.
// Gemessen innerhalb von 30 Tagen nach Versand.
const CONV_WITHOUT_PHONE = 0.003; // 0,3 %
const CONV_WITH_PHONE = 0.01; //    1,0 %

type LetterFormat = "din-lang" | "din-c4";

function formatEUR(n: number, withCents = false): string {
  return n.toLocaleString("de-DE", {
    minimumFractionDigits: withCents ? 2 : 0,
    maximumFractionDigits: withCents ? 2 : 0,
  });
}

export function ROIRechnerSection() {
  const [videos, setVideos] = React.useState(250);
  const [withPhone, setWithPhone] = React.useState(true);
  const [sendsLetters, setSendsLetters] = React.useState(true);
  const [letterFormat, setLetterFormat] =
    React.useState<LetterFormat>("din-lang");
  const [revenuePerCustomer, setRevenuePerCustomer] = React.useState(5000);

  const conversionRate = withPhone ? CONV_WITH_PHONE : CONV_WITHOUT_PHONE;
  const customers = Math.floor(videos * conversionRate);

  const vcCost = BASE_FEE + videos * PER_SEND_COST;
  const letterCostPerUnit =
    letterFormat === "din-lang" ? DIN_LANG_COST : DIN_C4_COST;
  const letterCost = sendsLetters ? videos * letterCostPerUnit : 0;
  const totalCost = vcCost + letterCost;

  const revenue = customers * revenuePerCustomer;
  const profit = revenue - totalCost;
  const roiPct = totalCost > 0 ? (profit / totalCost) * 100 : 0;

  return (
    <section
      id="roi-rechner"
      className="relative z-[2] w-full bg-surface py-24 md:py-32 overflow-hidden"
    >
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(70% 50% at 50% 0%, rgba(243,238,255,0.5) 0%, rgba(255,255,255,0) 60%)",
        }}
      />

      <div className="relative max-w-6xl mx-auto px-6 md:px-10">
        {/* Header */}
        <div className="max-w-2xl mx-auto text-center mb-14 md:mb-20">
          <RevealOnScroll delay={0}>
            <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-brand-soft text-brand-deep text-[11px] font-semibold tracking-[0.18em] uppercase mb-6">
              <Calculator className="size-3" />
              ROI-Rechner
            </div>
          </RevealOnScroll>
          <RevealOnScroll delay={150}>
            <h2 className="font-light tracking-[-0.035em] text-ink leading-[1.05] text-[clamp(32px,4.2vw,56px)] mb-5 text-balance">
              Was bringt dir das.
              <br />
              <span className="font-semibold text-brand-deep">
                Schwarz auf weiß.
              </span>
            </h2>
          </RevealOnScroll>
          <RevealOnScroll delay={300}>
            <p className="text-ink-muted text-lg leading-relaxed text-balance max-w-xl mx-auto">
              Rechne deinen Case durch. Wir nutzen Durchschnittswerte,
              keine Best-Case-Versprechen.
            </p>
          </RevealOnScroll>
        </div>

        {/* Rechner */}
        <RevealOnScroll delay={400}>
          <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-5 lg:gap-6">
            {/* === Form === */}
            <div className="rounded-3xl bg-white border border-line p-7 md:p-9 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.18)]">
              {/* Videos / Versand */}
              <FieldBlock
                label="Versand pro Monat"
                value={`${formatEUR(videos)} Stück`}
              >
                <Slider
                  min={0}
                  max={2000}
                  step={25}
                  value={videos}
                  onChange={setVideos}
                />
                <div className="flex justify-between text-[11px] text-ink-muted mt-2 tabular-nums">
                  <span>0</span>
                  <span>500</span>
                  <span>1.000</span>
                  <span>1.500</span>
                  <span>2.000</span>
                </div>
              </FieldBlock>

              {/* Telefonakquise */}
              <FieldBlock
                label="Strategie"
                sub="Wer nachtelefoniert, gewinnt etwa dreimal mehr Kunden innerhalb der ersten 30 Tage."
              >
                <Toggle
                  icon={<Phone className="size-3.5" />}
                  label="Mit Telefonakquise nachfassen"
                  rate={
                    withPhone
                      ? "≈ 1,0 % Conversion in 30 Tagen"
                      : "≈ 0,3 % Conversion in 30 Tagen"
                  }
                  checked={withPhone}
                  onChange={setWithPhone}
                />
              </FieldBlock>

              {/* Briefe */}
              <FieldBlock
                label="Versand-Form"
                sub="Briefe heben dich nochmal ab. Kosten kommen auf den Versand drauf."
              >
                <Toggle
                  icon={<Mail className="size-3.5" />}
                  label="Auch als physischer Brief"
                  rate={
                    sendsLetters
                      ? formatEUR(letterCostPerUnit, true) + " € pro Brief"
                      : "nur digital"
                  }
                  checked={sendsLetters}
                  onChange={setSendsLetters}
                />

                {sendsLetters ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <FormatRadio
                      checked={letterFormat === "din-lang"}
                      onChange={() => setLetterFormat("din-lang")}
                      title="DIN Lang"
                      sub="0,95 € Porto + 1 € Druck"
                    />
                    <FormatRadio
                      checked={letterFormat === "din-c4"}
                      onChange={() => setLetterFormat("din-c4")}
                      title="DIN C4"
                      sub="1,80 € Porto + 1 € Druck"
                    />
                  </div>
                ) : null}
              </FieldBlock>

              {/* Umsatz pro Kunde */}
              <FieldBlock
                label="Durchschnittlicher Umsatz pro Kunde"
                sub="Wert eines Neukunden für dich, brutto."
              >
                <CurrencyInput
                  value={revenuePerCustomer}
                  onChange={setRevenuePerCustomer}
                />
              </FieldBlock>
            </div>

            {/* === Ergebnis === */}
            <div
              className="relative rounded-3xl p-7 md:p-9 text-white overflow-hidden"
              style={{
                background:
                  "linear-gradient(160deg, #1A0E3A 0%, #2A1656 50%, #0F0820 100%)",
                boxShadow:
                  "0 24px 50px -18px rgba(15,23,42,0.5)",
              }}
            >
              {/* Subtle brand glow */}
              <div
                aria-hidden
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    "radial-gradient(45% 60% at 15% 15%, rgba(170,140,245,0.25) 0%, transparent 65%)",
                }}
              />

              <div className="relative">
                <div className="text-[10.5px] font-semibold tracking-[0.22em] uppercase text-white/55 mb-6">
                  Dein Monatlicher Case
                </div>

                {/* ROI BIG */}
                <div className="mb-7 pb-7 border-b border-white/10">
                  <div className="text-[12px] text-white/60 mb-2">
                    Return on Investment
                  </div>
                  <div
                    className="font-light tracking-[-0.04em] leading-none tabular-nums"
                    style={{
                      fontSize: "clamp(56px, 9vw, 96px)",
                      background:
                        "linear-gradient(180deg, #FFFFFF 0%, rgba(255,255,255,0.55) 100%)",
                      WebkitBackgroundClip: "text",
                      backgroundClip: "text",
                      color: "transparent",
                    }}
                  >
                    {roiPct >= 0 ? "+" : ""}
                    {formatEUR(Math.round(roiPct))}
                    <span
                      className="text-white/55"
                      style={{ fontSize: "0.45em" }}
                    >
                      {" "}
                      %
                    </span>
                  </div>
                </div>

                {/* KPIs */}
                <div className="grid grid-cols-2 gap-5">
                  <Kpi
                    label="Neue Kunden"
                    value={formatEUR(customers)}
                    suffix=""
                  />
                  <Kpi
                    label="Umsatz"
                    value={formatEUR(revenue)}
                    suffix="€"
                  />
                  <Kpi
                    label="Kosten gesamt"
                    value={formatEUR(Math.round(totalCost))}
                    suffix="€"
                    muted
                  />
                  <Kpi
                    label="Gewinn"
                    value={formatEUR(Math.round(profit))}
                    suffix="€"
                    highlight={profit > 0}
                  />
                </div>

                {/* Kosten-Breakdown */}
                <div className="mt-7 pt-6 border-t border-white/10">
                  <div className="text-[10.5px] font-semibold tracking-[0.22em] uppercase text-white/55 mb-3">
                    Kosten im Detail
                  </div>
                  <div className="space-y-1.5 text-[13px]">
                    <Row
                      label="VIDEOCOMET Grundgebühr"
                      value={`${formatEUR(BASE_FEE)} €`}
                    />
                    <Row
                      label={`${formatEUR(videos)} × 1 € Versand`}
                      value={`${formatEUR(videos * PER_SEND_COST)} €`}
                    />
                    {sendsLetters ? (
                      <Row
                        label={`${formatEUR(videos)} × ${formatEUR(
                          letterCostPerUnit,
                          true,
                        )} € Brief`}
                        value={`${formatEUR(Math.round(letterCost))} €`}
                      />
                    ) : null}
                    <div className="pt-2 mt-1 border-t border-white/10 flex justify-between font-semibold text-white">
                      <span>Gesamt</span>
                      <span className="tabular-nums">
                        {formatEUR(Math.round(totalCost))} €
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </RevealOnScroll>

        {/* Footer-Note */}
        <RevealOnScroll delay={550}>
          <p className="text-center text-[13px] text-ink-muted mt-10 max-w-3xl mx-auto leading-relaxed">
            <strong className="text-ink">Durchschnitts-Case, kein Best-Case.</strong>{" "}
            Die Conversion-Quoten (0,3 % ohne, 1 % mit Telefonakquise)
            sind Durchschnittswerte aus echten Kundenfällen, gemessen
            innerhalb von 30 Tagen nach Versand. Die tatsächliche
            Quote hängt stark von Leadqualität, Angebot, Marktreife
            und Vertriebsfähigkeiten ab.
          </p>
        </RevealOnScroll>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------

function FieldBlock({
  label,
  sub,
  value,
  children,
}: {
  label: string;
  sub?: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-7 last:mb-0">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <label className="text-[13.5px] font-bold text-ink">{label}</label>
        {value ? (
          <span className="text-[13px] font-semibold text-brand-deep tabular-nums">
            {value}
          </span>
        ) : null}
      </div>
      {sub ? (
        <p className="text-[12px] text-ink-muted mb-3">{sub}</p>
      ) : null}
      {children}
    </div>
  );
}

function Slider({
  min,
  max,
  step,
  value,
  onChange,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (n: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="relative h-6 flex items-center">
      <div className="absolute inset-x-0 h-1.5 rounded-full bg-ink/10" />
      <div
        className="absolute h-1.5 rounded-full bg-brand"
        style={{ width: `${pct}%`, left: 0 }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 w-full opacity-0 cursor-pointer"
        aria-label="Versand pro Monat"
      />
      <div
        className="absolute size-5 rounded-full bg-white border-2 border-brand pointer-events-none"
        style={{
          left: `calc(${pct}% - 10px)`,
          boxShadow: "0 4px 10px -2px rgba(124,92,232,0.4)",
        }}
      />
    </div>
  );
}

function Toggle({
  icon,
  label,
  rate,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  rate: string;
  checked: boolean;
  onChange: (b: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "w-full rounded-xl border px-3.5 py-3 flex items-center gap-3 transition-all text-left",
        checked
          ? "border-brand bg-brand-soft/40"
          : "border-line bg-white hover:border-brand/30",
      )}
    >
      <div
        className={cn(
          "size-7 rounded-lg flex items-center justify-center shrink-0",
          checked ? "bg-brand text-white" : "bg-surface-soft text-ink-muted",
        )}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-semibold text-ink leading-tight">
          {label}
        </div>
        <div className="text-[11.5px] text-ink-muted leading-tight mt-0.5 tabular-nums">
          {rate}
        </div>
      </div>
      <div
        className={cn(
          "w-9 h-5 rounded-full relative shrink-0 transition-colors",
          checked ? "bg-brand" : "bg-ink/15",
        )}
      >
        <div
          className="absolute top-0.5 size-4 rounded-full bg-white shadow transition-all"
          style={{
            left: checked ? "calc(100% - 18px)" : "2px",
          }}
        />
      </div>
    </button>
  );
}

function FormatRadio({
  checked,
  onChange,
  title,
  sub,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={cn(
        "rounded-xl border p-3 text-left transition-all",
        checked
          ? "border-brand bg-brand-soft/30"
          : "border-line bg-white hover:border-brand/30",
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] font-bold text-ink">{title}</span>
        {checked ? (
          <div className="size-4 rounded-full bg-brand flex items-center justify-center">
            <Check className="size-2.5 text-white" strokeWidth={3.5} />
          </div>
        ) : (
          <div className="size-4 rounded-full border border-line/80" />
        )}
      </div>
      <div className="text-[11px] text-ink-muted">{sub}</div>
    </button>
  );
}

function CurrencyInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        min={0}
        step={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full rounded-xl border border-line bg-white px-4 py-3 pr-8 text-[15px] font-semibold text-ink tabular-nums focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 transition-all"
      />
      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[14px] text-ink-muted">
        €
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function Kpi({
  label,
  value,
  suffix,
  muted,
  highlight,
}: {
  label: string;
  value: string;
  suffix: string;
  muted?: boolean;
  highlight?: boolean;
}) {
  return (
    <div>
      <div className="text-[11.5px] text-white/55 mb-1.5">{label}</div>
      <div
        className={cn(
          "font-semibold tracking-[-0.02em] leading-none tabular-nums",
          muted
            ? "text-white/70"
            : highlight
              ? "text-[#A8F5C8]"
              : "text-white",
        )}
        style={{ fontSize: "clamp(22px, 2.6vw, 30px)" }}
      >
        {value}
        {suffix ? (
          <span className="text-white/55 font-light ml-1 text-[0.6em]">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-white/65">{label}</span>
      <span className="text-white tabular-nums">{value}</span>
    </div>
  );
}
