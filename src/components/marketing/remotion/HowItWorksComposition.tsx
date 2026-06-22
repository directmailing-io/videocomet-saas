"use client";

import * as React from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// --- Step-Frame-Budget (30 fps) -------------------------------------------
// 1 Webcam   : 0 - 110   (110 = 3.67 s)
// 2 Szenen   : 110 - 230 (120 = 4.00 s)
// 3 Landing  : 230 - 370 (140 = 4.67 s)
// 4 Leads    : 370 - 520 (150 = 5.00 s)
// 5 Brief    : 520 - 640 (120 = 4.00 s)
// 6 Tracking : 640 - 800 (160 = 5.33 s)
// Total = 800 Frames = 26.67 s
export const HOWITWORKS_FPS = 30;
export const HOWITWORKS_FRAMES = 800;
export const HOWITWORKS_WIDTH = 1600;
export const HOWITWORKS_HEIGHT = 1000;

export const HOWITWORKS_STEPS = [
  { id: "webcam", from: 0, duration: 110, title: "Webcam" },
  { id: "scenes", from: 110, duration: 120, title: "Szenen" },
  { id: "landing", from: 230, duration: 140, title: "Landingpage" },
  { id: "leads", from: 370, duration: 150, title: "Leadliste" },
  { id: "letter", from: 520, duration: 120, title: "Brief" },
  { id: "tracking", from: 640, duration: 160, title: "Tracking" },
] as const;

const WEBCAM_MP4 = "/demo-assets/webcam.mp4";
const WEBSITE_MAX = "/demo-assets/website-max.png";

const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const INK = "#0F172A";
const INK_SOFT = "#475569";
const INK_MUTED = "#94A3B8";
const BRAND = "#7C5CE8";
const BRAND_LIGHT = "#AA8CF5";
const BRAND_SOFT = "#F3EEFF";
const SURFACE = "#FFFFFF";
const LINE = "#E2E8F0";

export default function HowItWorksComposition() {
  return (
    <AbsoluteFill
      style={{
        background:
          "radial-gradient(120% 100% at 80% 0%, #F3EEFF 0%, #FFFFFF 55%, #F8FAFC 100%)",
        fontFamily: FONT,
      }}
    >
      {HOWITWORKS_STEPS.map((step, i) => (
        <Sequence
          key={step.id}
          from={step.from}
          durationInFrames={step.duration}
          layout="none"
        >
          <StepFrame stepIndex={i} totalSteps={HOWITWORKS_STEPS.length}>
            {i === 0 ? <Step1Webcam /> : null}
            {i === 1 ? <Step2Scenes /> : null}
            {i === 2 ? <Step3Landing /> : null}
            {i === 3 ? <Step4Leads /> : null}
            {i === 4 ? <Step5Letter /> : null}
            {i === 5 ? <Step6Tracking /> : null}
          </StepFrame>
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

// ---------------------------------------------------------------------------
// Step-Frame: shared shell with crossfade + sticky step indicator
// ---------------------------------------------------------------------------
function StepFrame({
  children,
  stepIndex,
  totalSteps,
}: {
  children: React.ReactNode;
  stepIndex: number;
  totalSteps: number;
}) {
  const frame = useCurrentFrame();
  const duration = HOWITWORKS_STEPS[stepIndex].duration;
  // Nur am Ende rausfaden, am Anfang sofort sichtbar — sonst sieht der
  // User beim Seek auf den Sequence-Start einen leeren Frame.
  const opacity = interpolate(
    frame,
    [duration - 6, duration],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill style={{ opacity }}>
      {/* Step counter top-left */}
      <div
        style={{
          position: "absolute",
          top: 64,
          left: 80,
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: 3,
          textTransform: "uppercase",
          color: BRAND,
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 700,
            color: BRAND,
          }}
        >
          0{stepIndex + 1}
        </span>
        <span style={{ width: 24, height: 1, backgroundColor: BRAND_LIGHT }} />
        <span style={{ color: INK_MUTED, fontWeight: 500 }}>
          Schritt {stepIndex + 1} von {totalSteps}
        </span>
      </div>
      {children}
    </AbsoluteFill>
  );
}

function useEnter(delay: number, duration = 18) {
  // Per Default sofort 1 — Content ist beim Sequence-Start direkt sichtbar.
  // Optionale Animation laeuft per CSS-Keyframe (siehe `<style>` unten),
  // unabhaengig vom Remotion-Clock. Dadurch ist die Section auch dann
  // sichtbar, wenn der Player-Autoplay (z. B. iOS Safari) nicht greift.
  void delay;
  void duration;
  return 1;
}

// ===========================================================================
// STEP 1 — Webcam wählen
// ===========================================================================
function Step1Webcam() {
  const title = useEnter(0);
  const c1 = useEnter(4);
  const c2 = useEnter(10);
  const c3 = useEnter(16);
  const select = useEnter(40);
  const tag = useEnter(60);

  const cards = [
    { label: "Take A", initials: "CS", grad: "#AA8CF5,#7C5CE8" },
    { label: "Take B", initials: "JR", grad: "#10B981,#047857" },
    { label: "Take C", initials: "MK", grad: "#FBBF24,#D97706" },
  ];

  return (
    <>
      <Heading
        kicker="Webcam"
        title="Eine Aufnahme reicht."
        sub="Drei kurze Takes in deinem Studio aufgenommen. Du wählst, welcher in die Kampagne geht."
        anim={title}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 470,
          display: "flex",
          justifyContent: "center",
          gap: 40,
        }}
      >
        {cards.map((c, i) => {
          const t = [c1, c2, c3][i];
          const selected = i === 1;
          const sel = selected ? select : 0;
          return (
            <div
              key={c.label}
              style={{
                transform: `translateY(${(1 - t) * 30}px) scale(${
                  0.92 + t * 0.08 + sel * 0.05
                })`,
                opacity: t,
                position: "relative",
                width: 260,
                height: 360,
                borderRadius: 28,
                backgroundColor: SURFACE,
                border: `2px solid ${selected && sel > 0.5 ? BRAND : LINE}`,
                boxShadow: selected && sel > 0.5
                  ? `0 30px 60px -20px rgba(124,92,232,0.4), 0 0 0 6px ${BRAND_SOFT}`
                  : "0 12px 24px -10px rgba(15,23,42,0.15)",
                padding: 24,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 16,
                transition: "border-color 200ms",
              }}
            >
              <div
                style={{
                  width: 168,
                  height: 168,
                  borderRadius: "50%",
                  background: `linear-gradient(135deg, ${c.grad.split(",").join(", ")})`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#FFFFFF",
                  fontSize: 64,
                  fontWeight: 700,
                  letterSpacing: -2,
                }}
              >
                {c.initials}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: INK }}>
                {c.label}
              </div>
              <div style={{ fontSize: 13, color: INK_MUTED }}>
                {selected ? "1:24 · 1080p" : "0:58 · 1080p"}
              </div>
              {selected ? (
                <div
                  style={{
                    position: "absolute",
                    top: -14,
                    right: -14,
                    width: 40,
                    height: 40,
                    borderRadius: "50%",
                    backgroundColor: BRAND,
                    color: "#FFFFFF",
                    fontSize: 22,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 8px 18px rgba(124,92,232,0.5)",
                    transform: `scale(${sel})`,
                  }}
                >
                  ✓
                </div>
              ) : null}
              {selected ? (
                <div
                  style={{
                    position: "absolute",
                    bottom: -14,
                    left: "50%",
                    transform: `translateX(-50%) translateY(${(1 - tag) * 10}px)`,
                    opacity: tag,
                    padding: "6px 14px",
                    borderRadius: 999,
                    backgroundColor: INK,
                    color: "#FFFFFF",
                    fontSize: 12,
                    fontWeight: 600,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                  }}
                >
                  Ausgewählt
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ===========================================================================
// STEP 2 — Szenen
// ===========================================================================
function Step2Scenes() {
  const title = useEnter(0);
  const c0 = useEnter(4);
  const c1 = useEnter(10);
  const c2 = useEnter(16);
  const c3 = useEnter(22);
  const select = useEnter(46);
  const webcam = useEnter(56);

  const SCENES = [
    { label: "Website", palette: "#7C5CE8" },
    { label: "Folien", palette: "#FBBF24" },
    { label: "Doc", palette: "#10B981" },
    { label: "Solo", palette: "#EC4899" },
  ];

  return (
    <>
      <Heading
        kicker="Szenen"
        title="Was umgibt dich im Video?"
        sub="Website-Screenshot, Folien, persönliches Dokument oder reines Webcam-Solo. Deine Webcam sitzt automatisch im Bild."
        anim={title}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 470,
          display: "flex",
          justifyContent: "center",
          gap: 28,
        }}
      >
        {SCENES.map((s, i) => {
          const t = [c0, c1, c2, c3][i];
          const selected = i === 0;
          const sel = selected ? select : 0;
          return (
            <div
              key={s.label}
              style={{
                transform: `translateY(${(1 - t) * 26}px) scale(${
                  0.94 + t * 0.06 + sel * 0.04
                })`,
                opacity: t,
                position: "relative",
                width: 280,
                height: 220,
                borderRadius: 24,
                backgroundColor: SURFACE,
                border: `2px solid ${selected && sel > 0.5 ? BRAND : LINE}`,
                boxShadow: selected && sel > 0.5
                  ? `0 24px 50px -16px rgba(124,92,232,0.4), 0 0 0 6px ${BRAND_SOFT}`
                  : "0 10px 22px -10px rgba(15,23,42,0.12)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  flex: 1,
                  background: `linear-gradient(135deg, ${s.palette}40, ${s.palette}90)`,
                  position: "relative",
                }}
              >
                {/* tiny preview shapes */}
                <div
                  style={{
                    position: "absolute",
                    top: 22,
                    left: 22,
                    right: 22,
                    height: 14,
                    borderRadius: 4,
                    backgroundColor: "rgba(255,255,255,0.7)",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: 46,
                    left: 22,
                    width: 80,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: "rgba(255,255,255,0.6)",
                  }}
                />
                {/* webcam circle bottom-left appears on selected */}
                {selected ? (
                  <div
                    style={{
                      position: "absolute",
                      bottom: 16,
                      left: 16,
                      width: 56,
                      height: 56,
                      borderRadius: "50%",
                      background: "linear-gradient(135deg,#AA8CF5,#7C5CE8)",
                      border: "3px solid white",
                      boxShadow: "0 8px 18px rgba(15,23,42,0.35)",
                      opacity: webcam,
                      transform: `scale(${webcam})`,
                      color: "white",
                      fontSize: 18,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    CS
                  </div>
                ) : null}
              </div>
              <div
                style={{
                  padding: "14px 18px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>
                  {s.label}
                </span>
                {selected ? (
                  <span
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      backgroundColor: BRAND,
                      color: "white",
                      fontSize: 13,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transform: `scale(${sel})`,
                    }}
                  >
                    ✓
                  </span>
                ) : (
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      border: `1.5px solid ${INK_MUTED}`,
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ===========================================================================
// STEP 3 — Landingpage-Vorlage
// ===========================================================================
function Step3Landing() {
  const title = useEnter(0);
  const c0 = useEnter(4);
  const c1 = useEnter(10);
  const c2 = useEnter(16);
  const select = useEnter(50);
  const video = useEnter(72);

  const TEMPLATES = [
    {
      label: "Bold",
      heroColor: "#0F172A",
      accent: "#FBBF24",
      kind: "bold" as const,
    },
    {
      label: "Soft",
      heroColor: "#FCE7F3",
      accent: "#7C5CE8",
      kind: "soft" as const,
    },
    {
      label: "Klassisch",
      heroColor: "#1E293B",
      accent: "#10B981",
      kind: "classic" as const,
    },
  ];

  return (
    <>
      <Heading
        kicker="Landingpage"
        title="Drei Vorlagen. Dein Video sitzt mittendrin."
        sub="Suche dir ein Design aus. Headline, CTA und Platzhalter wie {Vorname} bleiben überall gleich."
        anim={title}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 470,
          display: "flex",
          justifyContent: "center",
          gap: 36,
        }}
      >
        {TEMPLATES.map((t, i) => {
          const tEnt = [c0, c1, c2][i];
          const selected = i === 1;
          const sel = selected ? select : 0;
          return (
            <div
              key={t.label}
              style={{
                transform: `translateY(${(1 - tEnt) * 30}px) scale(${
                  0.94 + tEnt * 0.06 + sel * 0.04
                })`,
                opacity: tEnt,
                position: "relative",
                width: 320,
                height: 400,
                borderRadius: 24,
                backgroundColor: SURFACE,
                border: `2px solid ${selected && sel > 0.5 ? BRAND : LINE}`,
                boxShadow: selected && sel > 0.5
                  ? `0 26px 56px -16px rgba(124,92,232,0.42), 0 0 0 6px ${BRAND_SOFT}`
                  : "0 12px 26px -10px rgba(15,23,42,0.15)",
                overflow: "hidden",
              }}
            >
              <LandingThumb template={t} videoEnter={selected ? video : 1} />
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  padding: "12px 18px",
                  backgroundColor: SURFACE,
                  borderTop: `1px solid ${LINE}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 700, color: INK }}>
                  {t.label}
                </span>
                {selected ? (
                  <span
                    style={{
                      padding: "4px 10px",
                      borderRadius: 999,
                      backgroundColor: BRAND,
                      color: "white",
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      transform: `scale(${sel})`,
                    }}
                  >
                    GEWÄHLT
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function LandingThumb({
  template,
  videoEnter,
}: {
  template: { heroColor: string; accent: string; kind: "bold" | "soft" | "classic" };
  videoEnter: number;
}) {
  const { heroColor, accent, kind } = template;
  return (
    <div
      style={{
        height: "calc(100% - 50px)",
        backgroundColor: kind === "soft" ? heroColor : SURFACE,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Header bar */}
      <div
        style={{
          height: 28,
          backgroundColor: kind === "bold" ? heroColor : SURFACE,
          borderBottom: kind === "soft" ? "none" : `1px solid ${LINE}`,
          display: "flex",
          alignItems: "center",
          padding: "0 14px",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 16,
            height: 6,
            borderRadius: 2,
            backgroundColor: kind === "bold" ? accent : INK,
          }}
        />
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {[1, 2, 3].map((j) => (
            <div
              key={j}
              style={{
                width: 18,
                height: 4,
                borderRadius: 2,
                backgroundColor:
                  kind === "bold" ? "rgba(255,255,255,0.4)" : INK_MUTED,
              }}
            />
          ))}
        </div>
      </div>
      {/* Hero block */}
      <div
        style={{
          padding: "20px 18px 14px 18px",
          backgroundColor:
            kind === "bold" ? heroColor : kind === "soft" ? heroColor : INK,
          color: kind === "soft" ? INK : "#FFFFFF",
          position: "relative",
        }}
      >
        <div
          style={{
            fontSize: 9,
            opacity: 0.6,
            textTransform: "uppercase",
            letterSpacing: 1.5,
            marginBottom: 6,
            color: accent,
            fontWeight: 700,
          }}
        >
          Persönlich für dich
        </div>
        <div
          style={{
            fontSize: 17,
            fontWeight: 800,
            lineHeight: 1.1,
            maxWidth: 160,
            marginBottom: 14,
          }}
        >
          {"{Vorname},"}
          <br />
          schau dir das an.
        </div>
        {/* Video circle/Card placement varies by template */}
        <div
          style={{
            position: kind === "bold" ? "absolute" : "relative",
            top: kind === "bold" ? 12 : undefined,
            right: kind === "bold" ? 12 : undefined,
            width: kind === "bold" ? 90 : "100%",
            height: kind === "bold" ? 90 : 130,
            borderRadius: kind === "bold" ? "50%" : 12,
            background: `linear-gradient(135deg, ${accent}, ${accent}aa)`,
            border: "3px solid white",
            boxShadow: "0 8px 18px rgba(0,0,0,0.25)",
            opacity: videoEnter,
            transform: `scale(${0.6 + videoEnter * 0.4})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontWeight: 700,
            fontSize: kind === "bold" ? 18 : 28,
          }}
        >
          ▶
        </div>
      </div>
      {/* Body content lines */}
      <div style={{ padding: "16px 18px", backgroundColor: SURFACE }}>
        {[100, 85, 70].map((w, j) => (
          <div
            key={j}
            style={{
              width: `${w}%`,
              height: 5,
              borderRadius: 3,
              backgroundColor: INK_MUTED,
              opacity: 0.35,
              marginBottom: 7,
            }}
          />
        ))}
        <div
          style={{
            marginTop: 12,
            display: "inline-block",
            padding: "5px 12px",
            borderRadius: 6,
            backgroundColor: accent,
            color: kind === "soft" ? INK : "white",
            fontSize: 9,
            fontWeight: 700,
          }}
        >
          Termin sichern →
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// STEP 4 — Leads hochladen / Vervielfachung
// ===========================================================================
function Step4Leads() {
  const title = useEnter(0);
  const csv = useEnter(4);
  const upload = useEnter(28);
  const morph = useEnter(60);
  const tag = useEnter(90);

  const LEADS = [
    { name: "Max Mustermann", company: "Mustermann Industrie", color: "#7C5CE8" },
    { name: "Lisa Lust", company: "Lust Cosmetics", color: "#EC4899" },
    { name: "Franz Friedrich", company: "Friedrich Manufaktur", color: "#92400E" },
    { name: "Sofia Reuter", company: "Reuter Coaching", color: "#10B981" },
  ];

  // Until frame 60, show single LP. After, morph to 2x2 grid.
  const single = 1 - morph;

  return (
    <>
      <Heading
        kicker="Leadliste"
        title="CSV rein. Persönliche Versionen raus."
        sub="Eine Zeile pro Empfänger, jede mit eigener Landingpage-URL. Die Liste landet in deinem Versand-Tool."
        anim={title}
      />

      {/* CSV file appearing top */}
      <div
        style={{
          position: "absolute",
          top: 240,
          left: "50%",
          transform: `translateX(-50%) translateY(${(1 - csv) * 20}px) translateY(${upload * -10}px) scale(${0.95 + csv * 0.05})`,
          opacity: csv * (1 - upload * 0.6),
          width: 360,
          padding: "14px 20px",
          backgroundColor: SURFACE,
          borderRadius: 16,
          border: `1px solid ${LINE}`,
          boxShadow: "0 16px 32px -12px rgba(15,23,42,0.2)",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 10,
            backgroundColor: BRAND_SOFT,
            color: BRAND,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
          }}
        >
          CSV
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>
            leads-q3-2026.csv
          </div>
          <div style={{ fontSize: 12, color: INK_MUTED, marginTop: 2 }}>
            12.043 Empfänger erkannt
          </div>
        </div>
        <div
          style={{
            color: "#10B981",
            fontSize: 20,
            transform: `scale(${upload})`,
          }}
        >
          ✓
        </div>
      </div>

      {/* Single LP at start, morphs into 2x2 */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 460,
          transform: "translateX(-50%)",
          width: 720,
          height: 460,
        }}
      >
        {/* center single big card (fades out as morph fades in) */}
        <div
          style={{
            position: "absolute",
            left: 180,
            top: 0,
            width: 360,
            height: 460,
            opacity: single,
            transform: `scale(${0.9 + single * 0.1})`,
          }}
        >
          <LeadCard lead={LEADS[0]} big />
        </div>

        {/* 2x2 grid */}
        {LEADS.map((lead, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const targetX = col * 380;
          const targetY = row * 240;
          return (
            <div
              key={lead.name}
              style={{
                position: "absolute",
                left: 180 + (targetX - 180) * morph * 1,
                top: targetY * morph,
                width: 360 - 100 * morph,
                height: 460 - 240 * morph,
                opacity: morph,
                transform: `scale(${0.9 + morph * 0.1})`,
                transformOrigin: "top left",
              }}
            >
              <LeadCard lead={lead} big={false} />
            </div>
          );
        })}

        {/* Counter badge */}
        <div
          style={{
            position: "absolute",
            top: -40,
            right: -40,
            padding: "8px 18px",
            backgroundColor: INK,
            color: "#FFFFFF",
            borderRadius: 999,
            fontSize: 13,
            fontWeight: 700,
            transform: `translateY(${(1 - tag) * 12}px)`,
            opacity: tag,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ color: BRAND_LIGHT, fontWeight: 700 }}>+12.039</span>{" "}
          weitere generiert
        </div>
      </div>
    </>
  );
}

function LeadCard({
  lead,
  big,
}: {
  lead: { name: string; company: string; color: string };
  big: boolean;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: SURFACE,
        borderRadius: big ? 18 : 14,
        border: `1px solid ${LINE}`,
        boxShadow: big
          ? "0 24px 50px -20px rgba(15,23,42,0.25)"
          : "0 14px 28px -14px rgba(15,23,42,0.18)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Hero stripe with name */}
      <div
        style={{
          padding: big ? "22px 22px" : "14px 16px",
          background: `linear-gradient(135deg, ${lead.color}30, ${lead.color}80)`,
          color: INK,
          position: "relative",
        }}
      >
        <div
          style={{
            fontSize: big ? 10 : 8,
            fontWeight: 700,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            opacity: 0.6,
          }}
        >
          Persönlich für
        </div>
        <div
          style={{
            fontSize: big ? 22 : 15,
            fontWeight: 800,
            lineHeight: 1.05,
            marginTop: 6,
          }}
        >
          {lead.name}
        </div>
        <div
          style={{
            fontSize: big ? 13 : 10,
            color: INK_SOFT,
            marginTop: 4,
          }}
        >
          {lead.company}
        </div>
        {/* Video placement */}
        <div
          style={{
            position: "absolute",
            bottom: -18,
            right: big ? 22 : 14,
            width: big ? 56 : 36,
            height: big ? 56 : 36,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${BRAND_LIGHT}, ${BRAND})`,
            border: "3px solid white",
            boxShadow: "0 6px 14px rgba(15,23,42,0.25)",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: big ? 16 : 12,
          }}
        >
          ▶
        </div>
      </div>
      {/* Body lines */}
      <div style={{ padding: big ? 22 : 14, flex: 1 }}>
        {[100, 80, 60].map((w, j) => (
          <div
            key={j}
            style={{
              width: `${w}%`,
              height: big ? 6 : 4,
              borderRadius: 3,
              backgroundColor: INK_MUTED,
              opacity: 0.3,
              marginBottom: big ? 9 : 6,
            }}
          />
        ))}
        <div
          style={{
            marginTop: big ? 14 : 8,
            display: "inline-block",
            padding: big ? "6px 14px" : "4px 10px",
            borderRadius: 6,
            backgroundColor: BRAND,
            color: "white",
            fontSize: big ? 10 : 8,
            fontWeight: 700,
          }}
        >
          /lp/{lead.name.split(" ")[0].toLowerCase()}-{lead.company.toLowerCase().replace(/[^a-z]/g, "").slice(0, 4)}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// STEP 5 — Brief
// ===========================================================================
function Step5Letter() {
  const title = useEnter(0);
  const p1 = useEnter(8);
  const p2 = useEnter(18);
  const p3 = useEnter(28);
  const badge = useEnter(60);

  const LETTERS = [
    { name: "Max Mustermann", street: "Industriestraße 42", city: "85737 Ismaning" },
    { name: "Lisa Lust", street: "Schanzenstraße 14", city: "20357 Hamburg" },
    { name: "Franz Friedrich", street: "Helmholtzstraße 16", city: "50825 Köln" },
  ];

  return (
    <>
      <Heading
        kicker="Brief"
        title="Druckfertiges PDF pro Empfänger."
        sub="Adresse, Anrede und Inhalt schon ausgefüllt. Drucke direkt oder gib das Bündel an deinen Druckdienst."
        anim={title}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 460,
          height: 460,
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-start",
        }}
      >
        <div style={{ position: "relative", width: 400, height: 440 }}>
          {LETTERS.map((l, i) => {
            const t = [p1, p2, p3][i];
            const offset = (i - 1) * 30;
            const rot = (i - 1) * -4;
            return (
              <div
                key={l.name}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: 380,
                  height: 440,
                  borderRadius: 8,
                  backgroundColor: SURFACE,
                  border: `1px solid ${LINE}`,
                  boxShadow: "0 22px 44px -22px rgba(15,23,42,0.35)",
                  padding: "44px 48px",
                  transform: `translate(${offset}px, ${offset * 0.4}px) rotate(${rot}deg) translateY(${(1 - t) * 30}px) scale(${0.9 + t * 0.1})`,
                  opacity: t,
                  zIndex: i,
                }}
              >
                {/* Mock letterhead */}
                <div
                  style={{
                    width: 50,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: BRAND,
                    marginBottom: 24,
                  }}
                />
                <div
                  style={{
                    fontSize: 11,
                    color: INK_MUTED,
                    lineHeight: 1.5,
                  }}
                >
                  Christoph Skuk · VIDEOCOMET
                  <br />
                  Beispielweg 1 · 50667 Köln
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: INK,
                    fontWeight: 600,
                    marginTop: 32,
                    lineHeight: 1.45,
                  }}
                >
                  {l.name}
                  <br />
                  {l.street}
                  <br />
                  {l.city}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: INK,
                    marginTop: 40,
                    lineHeight: 1.65,
                  }}
                >
                  Sehr geehrte/r {l.name.split(" ")[0]},<br />
                  ein persönliches Video für Sie liegt unter:
                  <br />
                  <span
                    style={{
                      color: BRAND_LIGHT,
                      fontWeight: 700,
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    videocomet.de/lp/{l.name.split(" ")[0].toLowerCase()}
                  </span>
                </div>
                {/* QR placeholder */}
                <div
                  style={{
                    position: "absolute",
                    bottom: 40,
                    right: 40,
                    width: 64,
                    height: 64,
                    background: `repeating-conic-gradient(${INK} 0deg 90deg, white 90deg 180deg)`,
                    border: `1px solid ${LINE}`,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Top-right tag */}
      <div
        style={{
          position: "absolute",
          top: 200,
          right: 80,
          padding: "10px 18px",
          backgroundColor: INK,
          color: "white",
          borderRadius: 12,
          fontSize: 13,
          fontWeight: 700,
          opacity: badge,
          transform: `translateY(${(1 - badge) * 14}px)`,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span style={{ color: BRAND_LIGHT }}>PDF</span> · druckfertig ·
        <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>3.631×</span>
      </div>
    </>
  );
}

// ===========================================================================
// STEP 6 — Tracking + Push-Notifications
// ===========================================================================
function Step6Tracking() {
  const title = useEnter(0);
  const dash = useEnter(8);

  const NOTIFS = [
    {
      delay: 28,
      icon: "👁️",
      who: "Max Mustermann",
      what: "hat deine Landingpage geöffnet",
      meta: "vor 2 Sekunden · Mustermann Industrie",
      color: "#10B981",
    },
    {
      delay: 56,
      icon: "▶️",
      who: "Lisa Lust",
      what: "schaut gerade dein Video (00:42)",
      meta: "vor 8 Sekunden · Lust Cosmetics",
      color: BRAND,
    },
    {
      delay: 84,
      icon: "🎯",
      who: "Franz Friedrich",
      what: "hat den Termin-Button geklickt",
      meta: "vor 14 Sekunden · Friedrich Manufaktur",
      color: "#FBBF24",
    },
  ];

  return (
    <>
      <Heading
        kicker="Tracking"
        title="Sieh live, was passiert."
        sub="Jede Öffnung, jede Watch-Time, jeder Klick. Direkt in VIDEOCOMET oder synchron in dein CRM."
        anim={title}
      />

      {/* Mock dashboard background */}
      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          top: 460,
          height: 460,
          borderRadius: 24,
          backgroundColor: SURFACE,
          border: `1px solid ${LINE}`,
          boxShadow: "0 30px 70px -30px rgba(15,23,42,0.3)",
          opacity: dash,
          transform: `translateY(${(1 - dash) * 30}px)`,
          padding: 36,
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {/* Top KPIs */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 18,
          }}
        >
          {[
            { l: "Versendet", v: "12.043", c: INK_SOFT },
            { l: "Geöffnet", v: "4.218", c: INK },
            { l: "Geschaut", v: "2.851", c: BRAND },
            { l: "CTA geklickt", v: "611", c: "#10B981" },
          ].map((k, i) => (
            <div
              key={i}
              style={{
                padding: "16px 20px",
                borderRadius: 14,
                backgroundColor: "#F8FAFC",
                border: `1px solid ${LINE}`,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: INK_MUTED,
                  textTransform: "uppercase",
                  letterSpacing: 1.2,
                  fontWeight: 600,
                }}
              >
                {k.l}
              </div>
              <div
                style={{
                  fontSize: 30,
                  fontWeight: 800,
                  color: k.c,
                  marginTop: 6,
                }}
              >
                {k.v}
              </div>
            </div>
          ))}
        </div>
        {/* Chart area */}
        <div
          style={{
            flex: 1,
            borderRadius: 16,
            backgroundColor: "#F8FAFC",
            border: `1px solid ${LINE}`,
            padding: 22,
            position: "relative",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: INK_MUTED,
              textTransform: "uppercase",
              letterSpacing: 1.2,
              fontWeight: 600,
            }}
          >
            Watch-Time-Verlauf
          </div>
          <svg
            viewBox="0 0 600 140"
            style={{ width: "100%", height: "calc(100% - 22px)", marginTop: 4 }}
          >
            <defs>
              <linearGradient id="vctk" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={BRAND_LIGHT} stopOpacity="0.55" />
                <stop offset="100%" stopColor={BRAND_LIGHT} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0,110 L40,100 L80,90 L120,95 L160,75 L200,80 L240,55 L280,45 L320,55 L360,32 L400,28 L440,20 L480,24 L520,12 L600,8 L600,140 L0,140 Z"
              fill="url(#vctk)"
            />
            <path
              d="M0,110 L40,100 L80,90 L120,95 L160,75 L200,80 L240,55 L280,45 L320,55 L360,32 L400,28 L440,20 L480,24 L520,12 L600,8"
              fill="none"
              stroke={BRAND}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      {/* Push notifications cascade — slide in from right */}
      <div
        style={{
          position: "absolute",
          top: 220,
          right: 80,
          width: 360,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {NOTIFS.map((n) => (
          <PushNotif key={n.who} {...n} />
        ))}
      </div>
    </>
  );
}

function PushNotif({
  delay,
  icon,
  who,
  what,
  meta,
  color,
}: {
  delay: number;
  icon: string;
  who: string;
  what: string;
  meta: string;
  color: string;
}) {
  const t = useEnter(delay, 22);
  return (
    <div
      style={{
        backgroundColor: "rgba(15,23,42,0.85)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderRadius: 18,
        padding: "14px 18px",
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
        border: "1px solid rgba(255,255,255,0.15)",
        boxShadow: "0 20px 40px -20px rgba(15,23,42,0.5)",
        transform: `translateX(${(1 - t) * 80}px)`,
        opacity: t,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          backgroundColor: color,
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ color: "white", flex: 1 }}>
        <div style={{ fontSize: 13, lineHeight: 1.3 }}>
          <span style={{ fontWeight: 700 }}>{who}</span>{" "}
          <span style={{ color: "rgba(255,255,255,0.7)" }}>{what}</span>
        </div>
        <div
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.5)",
            marginTop: 4,
          }}
        >
          {meta}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Shared: Heading
// ===========================================================================
function Heading({
  kicker,
  title,
  sub,
  anim,
}: {
  kicker: string;
  title: string;
  sub: string;
  anim: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: 150,
        left: 80,
        right: 80,
        opacity: anim,
        transform: `translateY(${(1 - anim) * 24}px)`,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 3,
          textTransform: "uppercase",
          color: BRAND,
          marginBottom: 18,
        }}
      >
        {kicker}
      </div>
      <h2
        style={{
          fontSize: 64,
          fontWeight: 800,
          lineHeight: 1.04,
          letterSpacing: "-0.025em",
          color: INK,
          margin: 0,
          maxWidth: 900,
        }}
      >
        {title}
      </h2>
      <p
        style={{
          fontSize: 22,
          color: INK_SOFT,
          marginTop: 18,
          maxWidth: 640,
          lineHeight: 1.5,
        }}
      >
        {sub}
      </p>
    </div>
  );
}

// Avoid TS unused imports
const _unused = { Img, staticFile, WEBCAM_MP4, WEBSITE_MAX };
void _unused;
