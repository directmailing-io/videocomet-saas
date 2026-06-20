/**
 * Tests für `src/lib/webhooks/payload-builder.ts`. Stellt sicher, dass:
 *   - jede Builder-Funktion die Frozen-Contract-Shape liefert
 *   - `id` immer `evt_<26>` ist und für jeden Aufruf neu ist
 *   - `version` immer `"1"` ist
 *   - Lead-Shortcuts case-insensitiv aus `data` extrahiert werden
 */
import { describe, expect, it } from "vitest";
import {
  buildLeadEventPayload,
  buildLeadCreatedPayload,
  buildRunEventPayload,
} from "@/lib/webhooks/payload-builder";

const FORMAT_RE = /^evt_[0-9A-HJKMNP-TV-Z]{26}$/;

const fakeLead = {
  id: "ld_1",
  slug: "max-mustermann",
  // Bewusst gemischte Case + Aliasse, um die case-insensitive Extraktion
  // im Webhook-Lead-Shortcut zu prüfen.
  data: {
    Vorname: "Max",
    NACHNAME: "Mustermann",
    "E-Mail": "max@example.com",
    telefon: "+49 30 12345",
    Strasse: "Hauptstr. 1",
    PLZ: "10115",
    Stadt: "Berlin",
    Custom: "freitext",
  },
};

const fakeRun = { id: "rn_1", name: "Mai-Kampagne" };
const fakeCampaign = { id: "ca_1", name: "Demo" };

describe("webhooks/payload-builder", () => {
  it("lead.opened: Shape entspricht WebhookPayload<LeadEventData>", () => {
    const p = buildLeadEventPayload("lead.opened", {
      lead: fakeLead,
      run: fakeRun,
      campaign: fakeCampaign,
      pageUrl: "https://app.videocomet.de/v/max-mustermann",
      event: { occurredAt: "2025-01-01T12:00:00.000Z", sessionId: "sess_1" },
    });
    expect(p.id).toMatch(FORMAT_RE);
    expect(p.kind).toBe("lead.opened");
    expect(p.version).toBe("1");
    expect(typeof p.ts).toBe("string");
    expect(p.data.lead.id).toBe("ld_1");
    expect(p.data.lead.slug).toBe("max-mustermann");
    expect(p.data.run).toEqual(fakeRun);
    expect(p.data.campaign).toEqual(fakeCampaign);
    expect(p.data.event.sessionId).toBe("sess_1");
    expect(p.data.lead.pageUrl).toBe("https://app.videocomet.de/v/max-mustermann");
  });

  it("Lead-Shortcuts werden case-insensitiv aus `data` extrahiert", () => {
    const p = buildLeadEventPayload("lead.opened", {
      lead: fakeLead,
      run: fakeRun,
      campaign: fakeCampaign,
      pageUrl: "https://example.com/v/x",
      event: { occurredAt: "2025-01-01T12:00:00.000Z" },
    });
    expect(p.data.lead.firstName).toBe("Max");
    expect(p.data.lead.lastName).toBe("Mustermann");
    expect(p.data.lead.email).toBe("max@example.com");
    expect(p.data.lead.phone).toBe("+49 30 12345");
    // Address kombiniert Straße + PLZ + Stadt
    expect(p.data.lead.address).toContain("Hauptstr. 1");
    expect(p.data.lead.address).toContain("10115");
    expect(p.data.lead.address).toContain("Berlin");
    // Originale `data` wird unverändert mitgeliefert
    expect(p.data.lead.data.Custom).toBe("freitext");
  });

  it("lead.video_progress trägt quartile + playedSec + durationSec", () => {
    const p = buildLeadEventPayload("lead.video_progress", {
      lead: fakeLead,
      run: fakeRun,
      campaign: fakeCampaign,
      pageUrl: "https://example.com/v/x",
      event: {
        occurredAt: "2025-01-01T12:00:00.000Z",
        playedSec: 30,
        durationSec: 60,
        quartile: 50,
      },
    });
    expect(p.data.event.quartile).toBe(50);
    expect(p.data.event.playedSec).toBe(30);
    expect(p.data.event.durationSec).toBe(60);
  });

  it("lead.cta_clicked trägt ctaLabel + ctaUrl", () => {
    const p = buildLeadEventPayload("lead.cta_clicked", {
      lead: fakeLead,
      run: fakeRun,
      campaign: fakeCampaign,
      pageUrl: "https://example.com/v/x",
      event: {
        occurredAt: "2025-01-01T12:00:00.000Z",
        ctaLabel: "Termin buchen",
        ctaUrl: "https://example.com/calendly",
      },
    });
    expect(p.data.event.ctaLabel).toBe("Termin buchen");
    expect(p.data.event.ctaUrl).toBe("https://example.com/calendly");
  });

  it("lead.created hat kind=lead.created", () => {
    const p = buildLeadCreatedPayload({
      lead: fakeLead,
      run: fakeRun,
      campaign: fakeCampaign,
      pageUrl: "https://example.com/v/x",
      event: { occurredAt: "2025-01-01T12:00:00.000Z" },
    });
    expect(p.kind).toBe("lead.created");
    expect(p.data.lead.firstName).toBe("Max");
  });

  it("run.completed: aggregates + ISO-Date-Strings", () => {
    const p = buildRunEventPayload("run.completed", {
      run: {
        id: "rn_1",
        name: "Mai-Kampagne",
        totalLeads: 100,
        completedLeads: 95,
        failedLeads: 5,
        startedAt: new Date("2025-01-01T10:00:00.000Z"),
        completedAt: new Date("2025-01-01T11:00:00.000Z"),
      },
      campaign: fakeCampaign,
    });
    expect(p.kind).toBe("run.completed");
    expect(p.data.run.totalLeads).toBe(100);
    expect(p.data.run.completedLeads).toBe(95);
    expect(p.data.run.failedLeads).toBe(5);
    expect(p.data.run.startedAt).toBe("2025-01-01T10:00:00.000Z");
    expect(p.data.run.completedAt).toBe("2025-01-01T11:00:00.000Z");
  });

  it("run.failed: null-Dates bleiben null", () => {
    const p = buildRunEventPayload("run.failed", {
      run: {
        id: "rn_1",
        name: "n",
        totalLeads: 10,
        completedLeads: 0,
        failedLeads: 10,
        startedAt: null,
        completedAt: null,
      },
      campaign: fakeCampaign,
    });
    expect(p.kind).toBe("run.failed");
    expect(p.data.run.startedAt).toBeNull();
    expect(p.data.run.completedAt).toBeNull();
  });

  it("Jeder Aufruf liefert eine neue, eindeutige id", () => {
    const a = buildLeadEventPayload("lead.opened", {
      lead: fakeLead,
      run: fakeRun,
      campaign: fakeCampaign,
      pageUrl: "https://example.com/v/x",
      event: { occurredAt: "2025-01-01T12:00:00.000Z" },
    });
    const b = buildLeadEventPayload("lead.opened", {
      lead: fakeLead,
      run: fakeRun,
      campaign: fakeCampaign,
      pageUrl: "https://example.com/v/x",
      event: { occurredAt: "2025-01-01T12:00:00.000Z" },
    });
    expect(a.id).not.toBe(b.id);
  });
});
