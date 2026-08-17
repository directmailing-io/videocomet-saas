"use client";

/**
 * Verbindungen-Tab: Webhooks + Automation-API zusammen mit klarer
 * Eingang/Ausgang-Trennung. Ersetzt die beiden bisherigen Tabs.
 */

import * as React from "react";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { ApiKeysPanel } from "../api-keys/api-keys-panel";
import { WebhooksList } from "../webhooks/webhooks-list";
import { WebhooksDocsCallout } from "../webhooks/webhooks-docs-callout";

type Direction = "in" | "out";

export function VerbindungenTab() {
  const [direction, setDirection] = React.useState<Direction>("in");

  return (
    <div className="space-y-6 mt-4">
      {/* Kurze Erklärung ganz oben */}
      <div className="bg-canvas-deep rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-ink mb-2">
          Was ist das hier?
        </h3>
        <p className="text-sm text-ink leading-relaxed">
          Hier verbindest du VIDEOCOMET mit anderen Tools wie Zapier, Make oder
          deinem CRM. Zwei Richtungen sind möglich, und du kannst beide gleichzeitig
          nutzen. Bei „Eingang" schicken andere Tools uns neue Kontakte, aus denen
          wir dann Videos machen. Bei „Ausgang" sagen wir anderen Tools sofort
          Bescheid, wenn zum Beispiel jemand dein Video geöffnet hat.
        </p>
      </div>

      {/* Umschaltung Eingang / Ausgang */}
      <div className="grid grid-cols-2 gap-2 bg-canvas rounded-2xl p-1.5">
        <button
          type="button"
          onClick={() => setDirection("in")}
          className={
            "flex items-start gap-3 p-4 rounded-xl transition-all text-left " +
            (direction === "in"
              ? "bg-surface shadow-card"
              : "hover:bg-canvas-deep")
          }
        >
          <div
            className={
              "size-10 rounded-lg flex items-center justify-center shrink-0 " +
              (direction === "in"
                ? "bg-ok-soft text-ok"
                : "bg-canvas-deep text-ink-muted")
            }
          >
            <ArrowDownToLine className="size-5" />
          </div>
          <div className="min-w-0">
            <div
              className={
                "text-sm font-semibold " +
                (direction === "in" ? "text-ink" : "text-ink-muted")
              }
            >
              Eingang: Kontakte reinbekommen
            </div>
            <div className="text-xs text-ink-muted mt-0.5 leading-relaxed">
              Zapier oder dein CRM schickt uns neue Kontakte. Wir legen sie an,
              stecken sie in eine Liste, und dann läuft automatisch dein Video.
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setDirection("out")}
          className={
            "flex items-start gap-3 p-4 rounded-xl transition-all text-left " +
            (direction === "out"
              ? "bg-surface shadow-card"
              : "hover:bg-canvas-deep")
          }
        >
          <div
            className={
              "size-10 rounded-lg flex items-center justify-center shrink-0 " +
              (direction === "out"
                ? "bg-brand-soft text-brand-deep"
                : "bg-canvas-deep text-ink-muted")
            }
          >
            <ArrowUpFromLine className="size-5" />
          </div>
          <div className="min-w-0">
            <div
              className={
                "text-sm font-semibold " +
                (direction === "out" ? "text-ink" : "text-ink-muted")
              }
            >
              Ausgang: andere Tools benachrichtigen
            </div>
            <div className="text-xs text-ink-muted mt-0.5 leading-relaxed">
              Sobald bei uns was passiert (jemand öffnet dein Video, klickt einen
              Link, füllt ein Formular aus), schicken wir eine Nachricht an dein
              anderes Tool.
            </div>
          </div>
        </button>
      </div>

      {/* Aktive Ansicht */}
      {direction === "in" ? (
        <div>
          <h2 className="text-base font-semibold text-ink mb-3">
            So bekommen Kontakte den Weg zu dir
          </h2>
          <ApiKeysPanel />
        </div>
      ) : (
        <div>
          <h2 className="text-base font-semibold text-ink mb-3">
            So sagst du anderen Tools Bescheid
          </h2>
          <div className="space-y-4">
            <WebhooksDocsCallout />
            <WebhooksList />
          </div>
        </div>
      )}
    </div>
  );
}
