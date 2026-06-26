export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireUserApi } from "@/lib/auth-guard";
import {
  getServiceAccountEmail,
  isDriveRendererConfigured,
} from "@/lib/google-docs/sa-auth";

/**
 * Diagnose-Endpoint fuer Wizard / Mediathek-UI.
 * Liefert: Status des Drive-Renderers + SA-Email (falls konfiguriert).
 * Wird fuer das Setup-Banner gebraucht (Anzeige "share Template mit
 * <SA-EMAIL>" UND Status-Indikator).
 */
export async function GET() {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;
  const flag = process.env.USE_GOOGLE_DRIVE_RENDERER === "1";
  const configured = isDriveRendererConfigured();
  // SECURITY: Die SA-Email ist sensitive Operator-Information (kann fuer
  // Social-Engineering gegen Google-Workspace-Admin genutzt werden). Nur
  // Admins sehen den Wert — alle anderen User bekommen `null`, was im
  // Setup-Banner als "Operator-Setup faellt aus" UX-mässig korrekt ist.
  const isAdmin = auth.user.role === "admin";
  return NextResponse.json({
    flag,
    configured,
    active: flag && configured,
    serviceAccountEmail: isAdmin ? getServiceAccountEmail() : null,
  });
}
