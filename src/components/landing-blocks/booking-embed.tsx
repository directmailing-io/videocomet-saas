"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { track } from "@/lib/tracker";
import type { BookingProvider } from "@/lib/booking-link";

/**
 * Client-Komponenten fuer die Kalender-Varianten des CTA-Banners:
 *
 *   - `BookingInline`  — eingebetteter Kalender in einer Karte. Auf
 *     Smartphones im Querformat (niedrige Viewport-Hoehe) wechselt sie
 *     automatisch auf einen Popup-Button, damit das Embed nie
 *     abgeschnitten wird (Konzept Abschnitt 4).
 *   - `BookingPopupButton` — Button im Primaer-Look, Klick oeffnet den
 *     Kalender als Overlay (Backdrop, ESC, Scroll-Lock).
 *
 * Die Embed-URL kommt fertig aus `detectBookingLink()`; nur Calendly
 * braucht zusaetzlich `embed_domain=<hostname>`, das hier im Browser
 * ergaenzt wird (Custom Domains machen den Hostname erst zur Laufzeit
 * bekannt).
 */

const IFRAME_TITLE = "Terminbuchung";

function buildClientSrc(embedUrl: string, provider: BookingProvider): string {
  if (provider !== "calendly") return embedUrl;
  try {
    const u = new URL(embedUrl);
    u.searchParams.set("embed_domain", window.location.hostname);
    u.searchParams.set("embed_type", "Inline");
    return u.toString();
  } catch {
    return embedUrl;
  }
}

/**
 * Finale iframe-src erst nach Mount berechnen — vermeidet Hydration-
 * Mismatches (Server kennt den Hostname fuer Calendly nicht).
 */
function useEmbedSrc(
  embedUrl: string,
  provider: BookingProvider,
): string | null {
  const [src, setSrc] = React.useState<string | null>(null);
  React.useEffect(() => {
    setSrc(buildClientSrc(embedUrl, provider));
  }, [embedUrl, provider]);
  return src;
}

/** true auf Viewports mit wenig Hoehe (Smartphone quer). */
function useShortViewport(): boolean {
  const [short, setShort] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(max-height: 500px)");
    const update = () => setShort(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return short;
}

function CalendarIframe({
  src,
  className,
  style,
}: {
  src: string | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={cn("w-full overflow-hidden", className)}
      style={{
        background: "var(--lp-color-surface)",
        borderRadius: "var(--lp-radius-card)",
        boxShadow: "var(--lp-shadow-card)",
        ...style,
      }}
    >
      {src && (
        <iframe
          src={src}
          title={IFRAME_TITLE}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="block h-full w-full border-0"
          style={{ minHeight: 620 }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overlay                                                             */
/* ------------------------------------------------------------------ */

function BookingOverlay({
  embedUrl,
  provider,
  onClose,
}: {
  embedUrl: string;
  provider: BookingProvider;
  onClose: () => void;
}) {
  const src = useEmbedSrc(embedUrl, provider);

  // ESC schliesst, Body-Scroll wird gesperrt solange das Overlay offen ist.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6"
      style={{ background: "rgba(0, 0, 0, 0.5)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={IFRAME_TITLE}
    >
      <div
        className="relative flex w-full max-w-2xl flex-col overflow-hidden"
        style={{
          background: "var(--lp-color-surface)",
          borderRadius: "var(--lp-radius-card)",
          boxShadow: "var(--lp-shadow-card)",
          height: "min(85vh, 720px)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Kalender schliessen"
          className="absolute right-2 top-2 z-10 flex h-11 w-11 items-center justify-center text-xl leading-none transition-opacity hover:opacity-70"
          style={{
            color: "var(--lp-color-text)",
            background: "var(--lp-color-surface)",
            borderRadius: "var(--lp-radius-button)",
            border: "1px solid var(--lp-color-border)",
          }}
        >
          <span aria-hidden="true">&times;</span>
        </button>
        {src && (
          <iframe
            src={src}
            title={IFRAME_TITLE}
            referrerPolicy="no-referrer-when-downgrade"
            className="block h-full w-full flex-1 border-0"
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Popup-Button                                                        */
/* ------------------------------------------------------------------ */

export interface BookingPopupButtonProps {
  embedUrl: string;
  provider: BookingProvider;
  label: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Button im Look des Primaer-CTAs; Klick oeffnet das Kalender-Overlay.
 * Feuert dasselbe `cta_click`-Event wie `<CtaButton>`, damit die
 * Statistik zwischen Link- und Popup-CTAs vergleichbar bleibt.
 */
export function BookingPopupButton({
  embedUrl,
  provider,
  label,
  className,
  style,
}: BookingPopupButtonProps) {
  const [open, setOpen] = React.useState(false);
  const handleOpen = React.useCallback(() => {
    track("cta_click", { label, url: embedUrl, position: "primary" });
    setOpen(true);
  }, [label, embedUrl]);
  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={cn("min-h-[44px] cursor-pointer", className)}
        style={style}
      >
        {label}
      </button>
      {open && (
        <BookingOverlay
          embedUrl={embedUrl}
          provider={provider}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Inline-Embed                                                        */
/* ------------------------------------------------------------------ */

export interface BookingInlineProps {
  embedUrl: string;
  provider: BookingProvider;
  /** Button-Label falls quer auf Popup umgeschaltet wird. */
  popupLabel: string;
  buttonClassName?: string;
  buttonStyle?: React.CSSProperties;
}

/**
 * Eingebetteter Kalender. Bei niedriger Viewport-Hoehe (Smartphone quer)
 * wird statt des Embeds ein Popup-Button gerendert — abgeschnittene
 * Kalender sind laut Konzept verboten.
 */
export function BookingInline({
  embedUrl,
  provider,
  popupLabel,
  buttonClassName,
  buttonStyle,
}: BookingInlineProps) {
  const short = useShortViewport();
  const src = useEmbedSrc(embedUrl, provider);

  if (short) {
    return (
      <div className="flex justify-center py-4 md:justify-start">
        <BookingPopupButton
          embedUrl={embedUrl}
          provider={provider}
          label={popupLabel}
          className={buttonClassName}
          style={buttonStyle}
        />
      </div>
    );
  }
  return <CalendarIframe src={src} />;
}
