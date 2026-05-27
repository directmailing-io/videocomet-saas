import Image from "next/image";
import { cn } from "@/lib/utils";

type LogoProps = {
  variant?: "horizontal" | "mark";
  className?: string;
  /** Höhe in px. Default: 28 (horizontal), 32 (mark) */
  height?: number;
};

export function Logo({ variant = "horizontal", className, height }: LogoProps) {
  if (variant === "mark") {
    const h = height ?? 32;
    return (
      <Image
        src="/logo-mark.svg"
        alt="VIDEOCOMET"
        width={Math.round(h * (32.1 / 42.08))}
        height={h}
        className={cn(className)}
        priority
      />
    );
  }
  const h = height ?? 28;
  return (
    <Image
      src="/logo-horizontal.svg"
      alt="VIDEOCOMET"
      width={Math.round(h * (179.13 / 41.94))}
      height={h}
      className={cn(className)}
      priority
    />
  );
}
