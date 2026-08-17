/**
 * Kleiner Toast-Helper: nimmt einen Fehler und zeigt ihn dem User in
 * verständlicher deutscher Sprache. Die Server-Message ist bereits für
 * den User geschrieben (siehe /api/…-Routen), also wird sie direkt als
 * Titel gezeigt, nicht hinter einem generischen „X konnte nicht Y werden".
 */

type ToastFn = (args: {
  title: string;
  description?: string;
  variant?: "default" | "success" | "danger";
}) => void;

export function toastError(toast: ToastFn, err: unknown, fallback?: string): void {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  toast({
    title: msg || fallback || "Das hat gerade nicht geklappt.",
    variant: "danger",
  });
}
