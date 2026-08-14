import { describe, expect, it } from "vitest";
import {
  leadFirstName,
  ogShareDescription,
  ogShareTitle,
} from "./landing-og";

describe("leadFirstName", () => {
  it("findet Vorname über Alias-Schreibweisen", () => {
    expect(leadFirstName({ Vorname: "marcel" })).toBe("Marcel");
    expect(leadFirstName({ firstName: "Anna" })).toBe("Anna");
    expect(leadFirstName({ first_name: "JÜRGEN" })).toBe("Jürgen");
    expect(leadFirstName({ " Vorname ": "Lena" })).toBe("Lena");
  });

  it("bevorzugt vorname vor firstName", () => {
    expect(leadFirstName({ firstName: "Anna", Vorname: "Ben" })).toBe("Ben");
  });

  it("behält Doppelnamen, kappt aber alles danach", () => {
    expect(leadFirstName({ vorname: "Marie Luise" })).toBe("Marie Luise");
    expect(leadFirstName({ vorname: "Anna GmbH" })).toBe("Anna");
  });

  it("lehnt Müll ab statt ihn ins Share-Bild zu schreiben", () => {
    expect(leadFirstName({ vorname: "" })).toBeNull();
    expect(leadFirstName({ vorname: "X" })).toBeNull();
    expect(leadFirstName({ vorname: "info@firma.de" })).toBeNull();
    expect(leadFirstName({ vorname: "123" })).toBeNull();
    expect(leadFirstName({ vorname: "{{vorname}}" })).toBeNull();
    expect(leadFirstName(null)).toBeNull();
    expect(leadFirstName("Marcel")).toBeNull();
    expect(leadFirstName({ firma: "ACME GmbH" })).toBeNull();
  });

  it("erlaubt Bindestrich- und Apostroph-Namen", () => {
    expect(leadFirstName({ vorname: "anne-kathrin" })).toBe("Anne-Kathrin");
    expect(leadFirstName({ vorname: "D'Angelo" })).toBe("D'Angelo");
  });
});

describe("ogShareTitle / ogShareDescription", () => {
  it("personalisiert mit Vornamen", () => {
    expect(ogShareTitle("Marcel")).toBe("Persönliches Video für Marcel");
    expect(ogShareDescription("Marcel")).toBe(
      "Marcel, dein persönliches Video wartet auf dich.",
    );
  });

  it("fällt neutral zurück", () => {
    expect(ogShareTitle(null)).toBe("Persönliche Videobotschaft");
    expect(ogShareDescription(null)).toBe(
      "Dein persönliches Video wartet auf dich.",
    );
  });
});
