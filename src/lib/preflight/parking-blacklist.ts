/**
 * Hard-coded blacklist of the most common domain-parking providers.
 *
 * Used by `url-probe.ts`: if a Lead's URL redirects to any of these hosts,
 * we flag it as `url_redirect_parking` so the operator doesn't ship a video
 * pointing at a Sedo / GoDaddy "this domain is for sale" page.
 *
 * Maintenance-Note: keep this list small + visible. Bigger lists (5k+
 * domains) belong in a dedicated package; for our 5-7 customers a hand-
 * curated list covers ~80 % of real-world parking pages.
 */

const PARKING_HOSTS: ReadonlySet<string> = new Set<string>([
  "sedo.com",
  "sedoparking.com",
  "sedo.de",
  "dan.com",
  "godaddy.com",
  "hugedomains.com",
  "afternic.com",
  "undeveloped.com",
  "parkingcrew.net",
  "parklogic.com",
  "bodis.com",
  "cashparking.com",
]);

/**
 * Subset of `PARKING_HOSTS` that only matches as a SUFFIX (sub-domain match).
 * Namecheap is special because the registrar's main site is legitimate; only
 * their park-* sub-domains are parking pages.
 */
const PARKING_SUFFIXES: readonly string[] = [
  ".parkingcrew.net",
  ".sedoparking.com",
  ".bodis.com",
  ".cashparking.com",
  // Namecheap parking — only sub-domains, not the registrar root.
  ".registrar-servers.com",
  ".park-website-1.namecheap.com",
  ".park-website-2.namecheap.com",
];

/** Strips a single leading `www.` prefix and lower-cases the host. */
function normaliseHost(host: string): string {
  const lower = host.trim().toLowerCase();
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}

/**
 * Returns `true` when the given host belongs to a known domain-parking
 * provider. Case-insensitive, www-stripped.
 *
 * NOTE: `host` is expected to be the bare hostname (no port, no path);
 * pass `new URL(redirectedUrl).hostname`.
 */
export function isParkingDomain(host: string): boolean {
  if (!host) return false;
  const h = normaliseHost(host);
  if (PARKING_HOSTS.has(h)) return true;
  for (const suffix of PARKING_SUFFIXES) {
    if (h.endsWith(suffix)) return true;
  }
  return false;
}
