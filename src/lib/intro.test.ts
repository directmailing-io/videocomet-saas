import { describe, expect, it } from "vitest";
import { countGreetingMentions } from "@/lib/intro";

describe("countGreetingMentions — QA-Gate gegen Doppel-Anrede", () => {
  it("zählt genau eine Anrede", () => {
    expect(countGreetingMentions("Hi Julia! Ich wollte dir kurz zeigen…")).toBe(1);
    expect(countGreetingMentions("Hallo Herr Müller, schön dass Sie da sind")).toBe(1);
    expect(countGreetingMentions("Guten Tag Frau Weber. Ich melde mich…")).toBe(1);
  });

  it("erkennt die Doppel-Anrede (Incident-Fall)", () => {
    expect(countGreetingMentions("Hi Julia! Hi! Ich nehme dieses Video auf")).toBe(2);
    expect(countGreetingMentions("Hallo Tobias. Hey, ich wollte…")).toBe(2);
  });

  it("case-insensitive und word-boundary (kein Treffer in „hier“/„Heyne“)", () => {
    expect(countGreetingMentions("hi daniel, komm mal hier rüber zu Herrn Heyne")).toBe(1);
    expect(countGreetingMentions("Der Tag war gut, moinsen")).toBe(0);
  });

  it("0 bei fehlender Anrede", () => {
    expect(countGreetingMentions("Ich wollte dir kurz ein Video aufnehmen")).toBe(0);
  });
});
