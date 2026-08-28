/** Gemeinsame Typen für den Wizard v4. */

import type { DedupeResult } from "@/lib/contacts/dedupe-check";
import type { ContactMapping } from "@/lib/contacts/mapping";

export type Step =
  | "source"
  | "import"
  | "options"
  | "mapping"
  | "start";

export const STEP_LABELS: Record<Step, string> = {
  source: "Woher?",
  import: "Kontakte rein",
  options: "Optionen",
  mapping: "Platzhalter",
  start: "Los",
};

export const STEP_ORDER: Step[] = ["source", "import", "options", "mapping", "start"];

export type SourceMode = "existing-list" | "new-upload";

/** Ein importierter Kontakt (nach Column-Mapping, vor Contact-Insert). */
export interface ImportedRow {
  rowIndex: number;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  customData: Record<string, string>;
}

export type PerRowDecision = "keep" | "skip";

export interface OptionsState {
  envelopeEnabled: boolean;
  envelopeTemplateId: string | null;
  emailEnabled: boolean;
  emailTemplateId: string | null;
  /** Nur wenn Kampagne with-presentation. */
  preflightEnabled: boolean;
  /** "Als Standard für diese Kampagne merken"-Toggle. */
  saveAsDefault: boolean;
}

export interface WizardState {
  step: Step;
  source: SourceMode | null;

  // Bei existing-list:
  selectedListId: string | null;

  // Follow-up-Modus (aus der Versand-Ansicht): Runde direkt aus frei
  // ausgewählten Kontakten, OHNE Liste (bewusst keine Auto-Listen).
  followUpContactIds: string[] | null;

  // Bei new-upload:
  parseId: string | null;
  headers: string[];
  previewRows: string[][];
  totalRows: number;
  columnMapping: Record<string, {
    slot:
      | "email"
      | "firstName"
      | "lastName"
      | "fullName"
      | "company"
      | "phone"
      | "linkedinUrl"
      | "salutation"
      | "title"
      | "externalId"
      | "street"
      | "postalCode"
      | "city"
      | "country"
      | "position"
      | "website"
      | "gender"
      | "custom"
      | "ignore";
    customKey?: string;
    customLabel?: string;
    customType?: string;
  }>;
  /** Nach dem Column-Mapping-Apply: der Contact-Liste, in die die
   *  Kontakte gelegt wurden (auto-erstellt oder vom User gewählt). */
  targetListId: string | null;
  targetListName: string;
  saveToListEnabled: boolean;

  // Dedupe-Ergebnis + Entscheidungen
  dedupeResults: DedupeResult[] | null;
  dedupeDecisions: Record<string, PerRowDecision>; // key = contactId
  primaryKey: "email" | "email_name" | "phone";
  contactedWithinDays: number;

  // Optionen
  options: OptionsState;

  // Mapping
  contactMapping: ContactMapping;

  // Runden-Name für Start-Screen
  runName: string;

  // Auto-Label: markiert alle Kontakte dieser Runde mit einem Label
  // (z. B. "Versand 28.08.2026"), damit man später filtern kann,
  // wer schon angeschrieben wurde.
  autoLabelEnabled: boolean;
  autoLabelName: string;
}

export function makeInitialState(): WizardState {
  return {
    step: "source",
    source: null,
    selectedListId: null,
    followUpContactIds: null,
    parseId: null,
    headers: [],
    previewRows: [],
    totalRows: 0,
    columnMapping: {},
    targetListId: null,
    targetListName: "",
    saveToListEnabled: true,
    dedupeResults: null,
    dedupeDecisions: {},
    primaryKey: "email",
    contactedWithinDays: 90,
    options: {
      envelopeEnabled: false,
      envelopeTemplateId: null,
      emailEnabled: false,
      emailTemplateId: null,
      preflightEnabled: true,
      saveAsDefault: false,
    },
    contactMapping: {},
    runName: `Runde ${new Date().toLocaleDateString("de-DE")}`,
    autoLabelEnabled: true,
    autoLabelName: `Versand ${new Date().toLocaleDateString("de-DE")}`,
  };
}
