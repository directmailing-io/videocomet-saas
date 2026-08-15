import { describe, expect, it } from "vitest";

import {
  bookingPrefillFromLead,
  detectBookingLink,
} from "./booking-link";

describe("detectBookingLink", () => {
  /* ---------------------------------------------------------------- */
  /* Calendly                                                          */
  /* ---------------------------------------------------------------- */

  it("erkennt calendly.com und haengt hide_gdpr_banner an", () => {
    const r = detectBookingLink("https://calendly.com/max/30min");
    expect(r.provider).toBe("calendly");
    expect(r.canEmbed).toBe(true);
    const u = new URL(r.embedUrl as string);
    expect(u.hostname).toBe("calendly.com");
    expect(u.searchParams.get("hide_gdpr_banner")).toBe("1");
  });

  it("erkennt www.calendly.com (Subdomain-Praefix)", () => {
    const r = detectBookingLink("https://www.calendly.com/max/30min");
    expect(r.provider).toBe("calendly");
    expect(r.canEmbed).toBe(true);
  });

  it("uebernimmt Calendly-Prefill als name/email-Parameter", () => {
    const r = detectBookingLink("https://calendly.com/max/30min", {
      name: "Anna Muster",
      email: "anna@example.com",
    });
    const u = new URL(r.embedUrl as string);
    expect(u.searchParams.get("name")).toBe("Anna Muster");
    expect(u.searchParams.get("email")).toBe("anna@example.com");
  });

  it("erhaelt bestehende Query-Parameter", () => {
    const r = detectBookingLink(
      "https://calendly.com/max/30min?month=2026-09&utm_source=lp",
    );
    const u = new URL(r.embedUrl as string);
    expect(u.searchParams.get("month")).toBe("2026-09");
    expect(u.searchParams.get("utm_source")).toBe("lp");
    expect(u.searchParams.get("hide_gdpr_banner")).toBe("1");
  });

  it("normalisiert http auf https", () => {
    const r = detectBookingLink("http://calendly.com/max/30min");
    expect(r.embedUrl).toMatch(/^https:\/\//);
  });

  it("faelscht keine calendly-Erkennung fuer evil-calendly.com.attacker.de", () => {
    const r = detectBookingLink("https://calendly.com.attacker.de/max");
    expect(r.provider).toBe("unknown");
    expect(r.canEmbed).toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /* Cal.com                                                           */
  /* ---------------------------------------------------------------- */

  it("erkennt cal.com und haengt embed=true an", () => {
    const r = detectBookingLink("https://cal.com/max/intro");
    expect(r.provider).toBe("cal-com");
    expect(r.canEmbed).toBe(true);
    const u = new URL(r.embedUrl as string);
    expect(u.searchParams.get("embed")).toBe("true");
  });

  it("erkennt app.cal.com als Subdomain", () => {
    const r = detectBookingLink("https://app.cal.com/max/intro", {
      name: "Anna",
      email: "anna@example.com",
    });
    expect(r.provider).toBe("cal-com");
    const u = new URL(r.embedUrl as string);
    expect(u.searchParams.get("name")).toBe("Anna");
    expect(u.searchParams.get("email")).toBe("anna@example.com");
  });

  /* ---------------------------------------------------------------- */
  /* Microsoft Bookings                                                */
  /* ---------------------------------------------------------------- */

  it("erkennt outlook.office365.com/owa/calendar/*", () => {
    const r = detectBookingLink(
      "https://outlook.office365.com/owa/calendar/team@firma.de/bookings/",
    );
    expect(r.provider).toBe("ms-bookings");
    expect(r.canEmbed).toBe(true);
    expect(r.embedUrl).toContain("/owa/calendar/");
  });

  it("erkennt outlook.office.com/bookwithme/*", () => {
    const r = detectBookingLink(
      "https://outlook.office.com/bookwithme/user/abc123@firma.de",
    );
    expect(r.provider).toBe("ms-bookings");
    expect(r.canEmbed).toBe(true);
  });

  it("erkennt *.bookings.microsoft.com", () => {
    const r = detectBookingLink("https://firma.bookings.microsoft.com/slot");
    expect(r.provider).toBe("ms-bookings");
    expect(r.canEmbed).toBe(true);
  });

  it("MS Bookings bekommt kein Prefill in die URL", () => {
    const r = detectBookingLink(
      "https://outlook.office.com/bookwithme/user/abc",
      { name: "Anna", email: "anna@example.com" },
    );
    const u = new URL(r.embedUrl as string);
    expect(u.searchParams.get("name")).toBeNull();
    expect(u.searchParams.get("email")).toBeNull();
  });

  it("outlook.office.com ohne Booking-Pfad bleibt unknown", () => {
    const r = detectBookingLink("https://outlook.office.com/mail/inbox");
    expect(r.provider).toBe("unknown");
    expect(r.canEmbed).toBe(false);
  });

  /* ---------------------------------------------------------------- */
  /* Google                                                            */
  /* ---------------------------------------------------------------- */

  it("erkennt calendar.google.com appointments/schedules als embedbar", () => {
    const r = detectBookingLink(
      "https://calendar.google.com/calendar/u/0/appointments/schedules/AcZs",
    );
    expect(r.provider).toBe("google");
    expect(r.canEmbed).toBe(true);
    expect(r.embedUrl).toContain("/appointments/");
  });

  it("calendar.app.google-Kurzlinks sind nicht framebar (Fallback)", () => {
    const r = detectBookingLink("https://calendar.app.google/abc123");
    expect(r.provider).toBe("google");
    expect(r.canEmbed).toBe(false);
    expect(r.embedUrl).toBeNull();
  });

  it("calendar.google.com ohne appointments-Pfad ist nicht embedbar", () => {
    const r = detectBookingLink("https://calendar.google.com/calendar/r");
    expect(r.provider).toBe("google");
    expect(r.canEmbed).toBe(false);
    expect(r.embedUrl).toBeNull();
  });

  /* ---------------------------------------------------------------- */
  /* HubSpot                                                           */
  /* ---------------------------------------------------------------- */

  it("erkennt meetings.hubspot.com mit embed=true und firstName-Prefill", () => {
    const r = detectBookingLink("https://meetings.hubspot.com/max", {
      name: "Anna Muster",
      email: "anna@example.com",
    });
    expect(r.provider).toBe("hubspot");
    expect(r.canEmbed).toBe(true);
    const u = new URL(r.embedUrl as string);
    expect(u.searchParams.get("embed")).toBe("true");
    expect(u.searchParams.get("firstName")).toBe("Anna Muster");
    expect(u.searchParams.get("email")).toBe("anna@example.com");
    expect(u.searchParams.get("name")).toBeNull();
  });

  it("erkennt meetings-eu1.hubspot.com", () => {
    const r = detectBookingLink("https://meetings-eu1.hubspot.com/max");
    expect(r.provider).toBe("hubspot");
    expect(r.canEmbed).toBe(true);
  });

  /* ---------------------------------------------------------------- */
  /* TidyCal                                                           */
  /* ---------------------------------------------------------------- */

  it("erkennt tidycal.com als direkt framebar", () => {
    const r = detectBookingLink("https://tidycal.com/max/15-minute-meeting");
    expect(r.provider).toBe("tidycal");
    expect(r.canEmbed).toBe(true);
    expect(r.embedUrl).toBe("https://tidycal.com/max/15-minute-meeting");
  });

  it("erkennt www.tidycal.com", () => {
    const r = detectBookingLink("https://www.tidycal.com/max");
    expect(r.provider).toBe("tidycal");
  });

  /* ---------------------------------------------------------------- */
  /* Muell-Input + Sicherheit                                          */
  /* ---------------------------------------------------------------- */

  it("leerer String ist unknown", () => {
    const r = detectBookingLink("");
    expect(r).toEqual({ provider: "unknown", embedUrl: null, canEmbed: false });
  });

  it("kein URL-Format ist unknown", () => {
    expect(detectBookingLink("kein link").provider).toBe("unknown");
    expect(detectBookingLink("calendly.com/max").provider).toBe("unknown");
  });

  it("nicht-http(s)-Schemata sind unknown", () => {
    expect(detectBookingLink("javascript:alert(1)").provider).toBe("unknown");
    expect(detectBookingLink("ftp://calendly.com/max").provider).toBe("unknown");
    expect(detectBookingLink("data:text/html,x").provider).toBe("unknown");
  });

  it("unbekannte Anbieter-Domain ist unknown ohne embedUrl", () => {
    const r = detectBookingLink("https://example.com/buchen");
    expect(r.provider).toBe("unknown");
    expect(r.canEmbed).toBe(false);
    expect(r.embedUrl).toBeNull();
  });
});

describe("bookingPrefillFromLead", () => {
  it("setzt Vor- und Nachname zusammen (deutsche Spalten)", () => {
    const p = bookingPrefillFromLead({
      Vorname: "Anna",
      Nachname: "Muster",
      "E-Mail": "anna@example.com",
    });
    expect(p.name).toBe("Anna Muster");
    expect(p.email).toBe("anna@example.com");
  });

  it("liest englische Spalten case-insensitive", () => {
    const p = bookingPrefillFromLead({
      FirstName: "Anna",
      lastname: "Muster",
      EMAIL: "anna@example.com",
    });
    expect(p.name).toBe("Anna Muster");
    expect(p.email).toBe("anna@example.com");
  });

  it("nur Vorname vorhanden reicht als Name", () => {
    const p = bookingPrefillFromLead({ vorname: "Anna" });
    expect(p.name).toBe("Anna");
    expect(p.email).toBeUndefined();
  });

  it("leere Werte werden ignoriert", () => {
    const p = bookingPrefillFromLead({ vorname: "  ", email: "" });
    expect(p.name).toBeUndefined();
    expect(p.email).toBeUndefined();
  });

  it("liefert leeres Objekt bei leerem/undefiniertem Input", () => {
    expect(bookingPrefillFromLead(undefined)).toEqual({});
    expect(bookingPrefillFromLead({})).toEqual({});
  });
});
