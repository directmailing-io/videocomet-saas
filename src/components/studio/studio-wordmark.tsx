import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/utils";

/**
 * „VIDEOCOMET Studio"-Lockup — die Sub-Brand des Studio-Modus.
 * Klassisches Logo + leichtes „Studio" daneben, Apple-like zurückhaltend.
 */
export function StudioWordmark({
  className,
  height = 20,
}: {
  className?: string;
  height?: number;
}) {
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <Logo variant="horizontal" height={height} className="translate-y-px" />
      <span
        className="font-light tracking-wide text-ink"
        style={{ fontSize: height * 0.82, lineHeight: 1 }}
      >
        Studio
      </span>
    </span>
  );
}
