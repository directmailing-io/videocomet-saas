import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import {
  getActiveLinkByToken,
  getFeedbackVideoMeta,
  listComments,
} from "@/lib/db/queries/video-feedback";
import { reviewCookieName, verifyReviewCookie } from "@/lib/feedback-cookie";
import { ReviewPasswordPrompt } from "./password-prompt";
import { FeedbackReviewer } from "./_components/feedback-reviewer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public-Feedback-Ansicht (`/review/<token>`).
 *
 *  1. Lookup aktiven Link — unbekannt/revoked/abgelaufen → `notFound()`.
 *  2. Wenn passwortgeschützt: Cookie prüfen → sonst Passwort-Prompt.
 *  3. Video-Meta + Kommentare laden → Reviewer im Guest-Modus rendern.
 */
export default async function ReviewPage({
  params,
}: {
  params: { token: string };
}) {
  const link = await getActiveLinkByToken(params.token);
  if (!link) notFound();

  if (link.hasPassword) {
    const raw = (await cookies()).get(reviewCookieName(params.token))?.value ?? null;
    if (!verifyReviewCookie(params.token, raw)) {
      return (
        <section className="mx-auto w-full max-w-md px-5 py-16">
          <ReviewPasswordPrompt token={params.token} />
        </section>
      );
    }
  }

  const [video, comments] = await Promise.all([
    getFeedbackVideoMeta(link.campaignId),
    listComments(link.id),
  ]);

  return (
    <FeedbackReviewer
      token={params.token}
      video={
        video ?? {
          campaignId: link.campaignId,
          campaignName: "Video",
          videoUrl: null,
          posterUrl: null,
          durationSec: null,
          width: null,
          height: null,
          mode: "webcam-only",
          segments: null,
          pipPosition: "bottom-left",
          pipShape: "rounded",
        }
      }
      initialComments={comments.map((c) => ({
        ...c,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
      }))}
      mode="guest"
    />
  );
}
