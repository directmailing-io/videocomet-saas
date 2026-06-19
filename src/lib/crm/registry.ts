/**
 * Provider-Registry. Single-Source-of-Truth, welcher Provider hinter
 * welchem `CrmProviderId`-Wert sitzt. Phase-2-Code (REST + Worker)
 * importiert NUR `getCrmProvider()` und arbeitet danach gegen das
 * generische `CrmProvider`-Interface.
 */

import type { CrmProvider, CrmProviderId } from "./types";
import { hubspotProvider } from "./hubspot";
import { salessuiteProvider } from "./salessuite";
import { closeProvider } from "./close";

const PROVIDERS: Record<CrmProviderId, CrmProvider> = {
  hubspot: hubspotProvider,
  salessuite: salessuiteProvider,
  close: closeProvider,
};

export function getCrmProvider(id: CrmProviderId): CrmProvider {
  return PROVIDERS[id];
}

export const ALL_CRM_PROVIDERS: CrmProviderId[] = [
  "hubspot",
  "salessuite",
  "close",
];
