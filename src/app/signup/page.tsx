import type { Metadata } from "next";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Zugang erhalten",
  alternates: { canonical: "/signup" },
  description:
    "Registriere dich für VIDEOCOMET. Startquartal 120 € netto inkl. 20 Credits, danach 40 € netto im Monat, monatlich kündbar. Zzgl. MwSt.",
};

export default function SignupPage() {
  return <SignupForm />;
}
