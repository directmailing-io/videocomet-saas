import type { Metadata } from "next";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Zugang erhalten — VIDEOCOMET",
  description:
    "Registriere dich für VIDEOCOMET. 40 € / Monat netto zzgl. MwSt., Mindestlaufzeit 3 Monate.",
};

export default function SignupPage() {
  return <SignupForm />;
}
