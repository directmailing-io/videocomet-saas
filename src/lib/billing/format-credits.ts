/**
 * Formatiert eine Credit-Balance fuer die UI. Ab 1.000.000 zeigen wir
 * das Unendlich-Symbol statt der eigentlichen Zahl — Kunden mit dieser
 * Balance sind interne/ausnahmehalber unbegrenzte Accounts. Faktisch
 * bleibt der Zaehler ein normaler Integer in der DB (max ~2,1 Mrd),
 * aber der User sieht "∞" statt "999.999.999".
 */

export const UNLIMITED_CREDIT_THRESHOLD = 1_000_000;

export function isUnlimitedCredits(balance: number): boolean {
  return balance >= UNLIMITED_CREDIT_THRESHOLD;
}

export function formatCreditBalance(balance: number): string {
  if (isUnlimitedCredits(balance)) return "∞";
  return balance.toLocaleString("de-DE");
}

/**
 * Label ("Credit" vs "Credits") passend zur Balance. Bei ∞ immer Plural.
 */
export function creditsLabel(balance: number): "Credit" | "Credits" {
  if (isUnlimitedCredits(balance)) return "Credits";
  return balance === 1 ? "Credit" : "Credits";
}
