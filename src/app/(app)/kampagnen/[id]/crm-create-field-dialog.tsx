"use client";

/**
 * Modal: Neues Custom-Feld im CRM anlegen.
 *
 * Wird sowohl von der Event-Field-Combobox als auch von der "Statische
 * Felder"-Sektion verwendet. Bei Salessuite (CrmFeatureUnsupported, 409)
 * zeigen wir statt eines Erfolgs-Submit einen Deep-Link zur Salessuite-
 * Properties-Page. tenantId kommt aus `integration.metadata.tenantId`.
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExternalLink, TriangleAlert } from "lucide-react";

export type FieldType = "datetime" | "text";

export interface CreatedCrmField {
  key: string;
  label: string;
  type: "datetime" | "text" | "number" | "boolean" | "other";
  readonly: boolean;
}

export interface CrmCreateFieldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integrationId: string;
  /**
   * Für die Salessuite-Deep-Link-Anzeige: tenantId aus der Integration-
   * metadata. Fällt auf undefined zurück → wir zeigen den Properties-Link
   * dann ohne Tenant-Pfad (Salessuite redirect-flow).
   */
  salessuiteTenantId?: string;
  defaultLabel?: string;
  defaultType?: FieldType;
  onCreated: (field: CreatedCrmField) => void;
}

interface ErrorResponse {
  error?: string;
}

interface SuccessResponse {
  field: CreatedCrmField;
}

export function CrmCreateFieldDialog({
  open,
  onOpenChange,
  integrationId,
  salessuiteTenantId,
  defaultLabel,
  defaultType,
  onCreated,
}: CrmCreateFieldDialogProps) {
  const [label, setLabel] = React.useState(defaultLabel ?? "");
  const [type, setType] = React.useState<FieldType>(defaultType ?? "datetime");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [unsupported, setUnsupported] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setLabel(defaultLabel ?? "");
      setType(defaultType ?? "datetime");
      setError(null);
      setUnsupported(null);
      setSubmitting(false);
    }
  }, [open, defaultLabel, defaultType]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!label.trim()) {
      setError("Bitte einen Label-Namen angeben.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/crm/integrations/${integrationId}/fields`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ label: label.trim(), type }),
        },
      );
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as ErrorResponse;
        setUnsupported(
          body.error ??
            "Dieser Anbieter erlaubt das Anlegen von Custom-Feldern nicht über die API.",
        );
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ErrorResponse;
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as SuccessResponse;
      onCreated(body.field);
      onOpenChange(false);
    } catch {
      setError("Verbindung zum Server fehlgeschlagen.");
    } finally {
      setSubmitting(false);
    }
  }

  const salessuiteUrl = salessuiteTenantId
    ? `https://app.salessuite.com/t/${encodeURIComponent(salessuiteTenantId)}/settings/properties`
    : "https://app.salessuite.com/settings/properties";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Neues CRM-Feld anlegen</DialogTitle>
          <DialogDescription>
            Legt ein neues Custom-Property am Kontakt-Objekt im CRM an.
          </DialogDescription>
        </DialogHeader>

        {unsupported ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 rounded-squircle-sm border border-warn/30 bg-warn-soft/40 px-3 py-3 text-sm text-ink">
              <TriangleAlert className="size-4 text-warn shrink-0 mt-0.5" />
              <p className="min-w-0 break-words">{unsupported}</p>
            </div>
            <p className="text-sm text-ink-muted">
              Bei Salessuite werden Custom-Fields ausschließlich direkt im
              Salessuite-Backend angelegt. Sobald das Feld dort existiert,
              erscheint es hier in der Auswahl.
            </p>
            <DialogFooter>
              <Button
                variant="ghost"
                type="button"
                onClick={() => onOpenChange(false)}
              >
                Schließen
              </Button>
              <Button asChild iconRight={<ExternalLink className="size-4" />}>
                <a
                  href={salessuiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  In Salessuite öffnen
                </a>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <Label htmlFor="crm-field-label">Feld-Name (Label)</Label>
              <Input
                id="crm-field-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="z.B. VIDEOCOMET — letzter Aufruf"
                disabled={submitting}
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-ink-muted">
                So heißt das Feld später in Ihrem CRM.
              </p>
            </div>

            <div>
              <Label htmlFor="crm-field-type">Feld-Typ</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as FieldType)}
                disabled={submitting}
              >
                <SelectTrigger id="crm-field-type">
                  <SelectValue placeholder="Typ wählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="datetime">Datum &amp; Uhrzeit</SelectItem>
                  <SelectItem value="text">Text</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 rounded-squircle-sm border border-danger/30 bg-danger-soft/40 px-3 py-2.5 text-sm text-danger">
                <TriangleAlert className="size-4 shrink-0 mt-0.5" />
                <p className="min-w-0 break-words">{error}</p>
              </div>
            )}

            <DialogFooter>
              <Button
                variant="ghost"
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Abbrechen
              </Button>
              <Button type="submit" loading={submitting}>
                Feld anlegen
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
