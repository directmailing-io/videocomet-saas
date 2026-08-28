import { redirect } from "next/navigation";

/** Alte Route — der E-Mail-Versand lebt jetzt im Versand-Tab der Runden-Seite. */
export default function EmailVersandPage() {
  redirect("/dashboard");
}
