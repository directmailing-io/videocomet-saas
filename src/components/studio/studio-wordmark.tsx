import Image from "next/image";
import { Outfit } from "next/font/google";
import { cn } from "@/lib/utils";

// Die Schrift des Logo-Wordmarks (Outfit Medium) — nur so wirkt „Studio"
// wie Teil desselben Lockups statt wie danebengesetzter UI-Text.
const outfit = Outfit({ subsets: ["latin"], weight: "500" });

/**
 * „VIDEOCOMET Studio"-Lockup — die Sub-Brand des Studio-Modus.
 *
 * Nutzt eine eng zugeschnittene Logo-Variante (ohne die Leerräume des
 * Original-SVGs, viewBox 0 0 152.5 27.2, Baseline bei y=23.29) und setzt
 * „Studio" in exakt der Schriftgröße des Wordmarks (19/27.2 der Höhe),
 * baseline-genau ausgerichtet.
 */
export function StudioWordmark({
  className,
  height = 22,
}: {
  className?: string;
  height?: number;
}) {
  const fontSize = height * (19 / 27.2);
  // Bild-Unterkante liegt (27.2−23.29)/27.2 der Höhe unter der Baseline.
  const baselineLift = height * ((27.2 - 23.29) / 27.2);
  return (
    <span
      className={cn("inline-flex items-baseline", className)}
      style={{ gap: fontSize * 0.34 }}
    >
      <Image
        src="/logo-horizontal-tight.svg"
        alt="VIDEOCOMET"
        width={Math.round(height * (152.5 / 27.2))}
        height={height}
        style={{ transform: `translateY(${baselineLift.toFixed(2)}px)` }}
        priority
      />
      <span
        className={outfit.className}
        style={{
          fontSize,
          lineHeight: 1,
          letterSpacing: "-0.02em",
          // Brand-Violett (tailwind `brand.deep`): genug Kontrast auf Weiß
          // (#fff) und Lavendel-Canvas, hebt „Studio" als Sub-Brand ab.
          color: "#7c5ce8",
        }}
      >
        Studio
      </span>
    </span>
  );
}
