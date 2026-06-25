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
  return NextResponse.json({
    flag,
    configured,
    active: flag && configured,
    serviceAccountEmail: getServiceAccountEmail(),
  });
}
