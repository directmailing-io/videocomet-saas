import { redirect } from "next/navigation";

/** Alte Route — der E-Mail-Versand lebt jetzt in der Versandzentrale. */
export default function EmailVersandPage() {
  redirect("/versand?tab=emails");
}
