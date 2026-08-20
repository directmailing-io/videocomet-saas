"use client";

import * as React from "react";
import Script from "next/script";
import { hasConsent, CONSENT_CHANGED_EVENT } from "@/components/consent/consent";

interface Props {
  pixelId: string;
  /**
   * Vom Root-Layout aus dem SSR-Cookie-Read übergeben. Wenn true,
   * lädt der Pixel SOFORT beim Hydration (statt erst nach useEffect-
   * Cookie-Check), sodass Meta Pixel Helper ihn beim Load-Scan sieht.
   */
  initialMarketingConsent?: boolean;
}

/**
 * Lädt den Meta-Pixel-Base-Snippet + `fbq('init', PIXEL_ID)` + `PageView`.
 *
 * Ausschließlich, wenn `hasConsent("marketing")` true ist. Reagiert live auf
 * Widerruf: fbq wird auf `disabled` gesetzt (Meta-empfohlene Kill-Switch-
 * Konvention `fbq('consent', 'revoke')`) und die nächste Route sendet
 * keine Events mehr — die aktuelle Session bleibt "leise" bis Reload.
 *
 * Warum kein Route-Change-PageView: Meta lädt das Script nur nach Consent,
 * und Standard-Snippet feuert PageView bei init. Bei clientseitigen
 * Navigationen (App-Router) wollen wir zusätzlich PageView tracken —
 * deshalb der zweite useEffect mit `pathname`-Watcher.
 */
export function MetaPixelLoader({
  pixelId,
  initialMarketingConsent = false,
}: Props) {
  // Initial-Value aus SSR: kein Client-Delay mehr, kein Race gegen den
  // Pixel-Helper, der beim Load-Scan sonst „keine Pixel" meldet.
  const [enabled, setEnabled] = React.useState(initialMarketingConsent);

  React.useEffect(() => {
    // Nach Hydration: Cookie noch mal client-seitig prüfen (deckt den
    // Fall ab, dass zwischen SSR und Hydration ein Consent-Wechsel in
    // einem anderen Tab passiert ist).
    setEnabled(hasConsent("marketing"));
    const onChange = () => setEnabled(hasConsent("marketing"));
    window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
  }, []);

  // Wenn ein User Consent widerruft nachdem Pixel schon geladen war:
  // fbq('consent', 'revoke') stoppt weitere Auto-Events, bis er zustimmt
  // (das behält Meta selbst als Kill-Switch). Reload räumt komplett auf.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!enabled && typeof window.fbq === "function") {
      try {
        window.fbq("consent", "revoke");
      } catch {
        /* ignore */
      }
    }
    if (enabled && typeof window.fbq === "function") {
      try {
        window.fbq("consent", "grant");
      } catch {
        /* ignore */
      }
    }
  }, [enabled]);

  if (!enabled || !pixelId) return null;

  return (
    <>
      <Script id="meta-pixel-base" strategy="afterInteractive">
        {`
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixelId}');
fbq('track', 'PageView');
        `}
      </Script>
      <noscript>
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
          alt=""
        />
      </noscript>
    </>
  );
}
