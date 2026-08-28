import { redirect } from "next/navigation";

/**
 * Alte Route — die Versandzentrale ist aufgelöst: Versand lebt jetzt als
 * Tab direkt auf der Runden-Seite, offene Runden zeigt das Dashboard.
 */
export default function VersandPage() {
  redirect("/dashboard");
}
