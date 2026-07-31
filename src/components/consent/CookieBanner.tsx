"use client";

import * as React from "react";
import Link from "next/link";
import { X } from "lucide-react";
import {
  OPEN_SETTINGS_EVENT,
  readConsent,
  writeConsent,
} from "./consent";

const MARKETING_HOSTS = new Set([
  "videocomet.de",
  "www.videocomet.de",
  "localhost",
  "127.0.0.1",
]);

/**
 * Cookie-Banner + Einstellungs-Modal.
 *
 * Wird nur auf der Marketing-Domain gerendert (nicht auf Custom-Domains
 * der Kunden und nicht in der App). Aktuell setzen wir ausschliesslich
 * technisch notwendige Cookies — der Banner informiert daher vor allem
 * transparent und haelt die Infrastruktur fuer kuenftige, einwilligungs-
 * pflichtige Dienste (Statistik) bereit.
 */
export function CookieBanner() {
  const [visible, setVisible] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [statistics, setStatistics] = React.useState(false);
  const [isMarketingHost, setIsMarketingHost] = React.useState(false);

  React.useEffect(() => {
    const onMarketing = MARKETING_HOSTS.has(window.location.hostname);
    setIsMarketingHost(onMarketing);
    if (!onMarketing) return;
    const existing = readConsent();
    if (existing) {
      setStatistics(existing.categories.statistics);
    } else {
      setVisible(true);
    }
    const openSettings = () => {
      const current = readConsent();
      if (current) setStatistics(current.categories.statistics);
      setSettingsOpen(true);
      setVisible(false);
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, openSettings);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, openSettings);
  }, []);

  if (!isMarketingHost || (!visible && !settingsOpen)) return null;

  const acceptAll = () => {
    writeConsent({ statistics: true });
    setVisible(false);
    setSettingsOpen(false);
  };
  const acceptNecessary = () => {
    writeConsent({ statistics: false });
    setVisible(false);
    setSettingsOpen(false);
  };
  const saveSelection = () => {
    writeConsent({ statistics });
    setVisible(false);
    setSettingsOpen(false);
  };

  const btnBase =
    "h-10 px-5 rounded-full text-[13.5px] font-semibold transition-colors whitespace-nowrap";

  return (
    <>
      {/* Erste Ebene: Banner */}
      {visible && !settingsOpen && (
        <div
          role="dialog"
          aria-label="Cookie-Hinweis"
          className="fixed inset-x-0 bottom-0 z-[90] p-3 sm:p-5"
        >
          <div className="max-w-3xl mx-auto rounded-2xl bg-white border border-line shadow-[0_18px_50px_-12px_rgba(15,23,42,0.35)] p-5 sm:p-6">
            <h2 className="text-[15px] font-bold text-ink mb-1.5">
              Cookies bei VIDEOCOMET
            </h2>
            <p className="text-[13px] text-ink-muted leading-relaxed mb-4">
              Wir verwenden ausschließlich technisch notwendige Cookies, damit
              Login und Sicherheit funktionieren. Statistik- oder
              Marketing-Cookies setzen wir nur, wenn du zustimmst. Aktuell
              nutzen wir keine. Details in unserer{" "}
              <Link href="/datenschutz" className="underline hover:text-ink">
                Datenschutzerklärung
              </Link>
              .
            </p>
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <button
                type="button"
                onClick={acceptAll}
                className={`${btnBase} bg-ink text-white hover:bg-ink/90`}
              >
                Alle akzeptieren
              </button>
              <button
                type="button"
                onClick={acceptNecessary}
                className={`${btnBase} bg-white border-2 border-ink text-ink hover:bg-ink/5`}
              >
                Nur notwendige
              </button>
              <button
                type="button"
                onClick={() => {
                  setSettingsOpen(true);
                }}
                className="sm:ml-auto text-[13px] text-ink-muted underline hover:text-ink text-left sm:text-right py-1"
              >
                Einstellungen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Zweite Ebene: Einstellungen */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center bg-ink/40 p-0 sm:p-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              // Ohne gespeicherte Wahl bleibt der Banner offen.
              setSettingsOpen(false);
              if (!readConsent()) setVisible(true);
            }
          }}
        >
          <div
            role="dialog"
            aria-label="Cookie-Einstellungen"
            className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl bg-white shadow-xl p-5 sm:p-7 max-h-[85vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-lg font-bold text-ink">
                Cookie-Einstellungen
              </h2>
              <button
                type="button"
                aria-label="Schließen"
                onClick={() => {
                  setSettingsOpen(false);
                  if (!readConsent()) setVisible(true);
                }}
                className="text-ink-muted hover:text-ink p-1"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="space-y-3 mb-5">
              <div className="rounded-xl border border-line bg-surface-soft p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[14px] font-semibold text-ink">
                    Notwendig
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600">
                    Immer aktiv
                  </span>
                </div>
                <p className="text-[12.5px] text-ink-muted leading-relaxed">
                  Erforderlich für Login, Sicherheit und das Speichern deiner
                  Cookie-Auswahl. Cookies: videocomet_session (Login-Sitzung),
                  vc_consent (deine Auswahl, 6 Monate). Auf dem
                  Registrierungsformular schützt Cloudflare Turnstile vor
                  Bots.
                </p>
              </div>

              <div className="rounded-xl border border-line p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[14px] font-semibold text-ink">
                    Statistik
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={statistics}
                    onClick={() => setStatistics((v) => !v)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      statistics ? "bg-ink" : "bg-line"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                        statistics ? "translate-x-[22px]" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
                <p className="text-[12.5px] text-ink-muted leading-relaxed">
                  Hilft uns zu verstehen, wie die Website genutzt wird.
                  Derzeit setzen wir keine Statistik-Dienste ein. Falls sich
                  das ändert, werden sie nur mit deiner Zustimmung geladen.
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={saveSelection}
                className={`${btnBase} bg-white border-2 border-ink text-ink hover:bg-ink/5`}
              >
                Auswahl speichern
              </button>
              <button
                type="button"
                onClick={acceptAll}
                className={`${btnBase} bg-ink text-white hover:bg-ink/90`}
              >
                Alle akzeptieren
              </button>
            </div>
            <p className="text-[11.5px] text-ink-muted mt-4 leading-relaxed">
              Du kannst deine Auswahl jederzeit über den Link
              „Cookie-Einstellungen" im Footer ändern. Mehr dazu in der{" "}
              <Link href="/datenschutz" className="underline hover:text-ink">
                Datenschutzerklärung
              </Link>
              .
            </p>
          </div>
        </div>
      )}
    </>
  );
}
