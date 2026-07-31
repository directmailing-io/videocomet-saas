import type { Metadata } from "next";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Zugang erhalten · VIDEOCOMET",
  description:
    "Registriere dich für VIDEOCOMET. 120 € netto für 3 Monate (3 × 40 €) zzgl. MwSt., Mindestlaufzeit 3 Monate.",
};

export default function SignupPage() {
  return <SignupForm />;
}
