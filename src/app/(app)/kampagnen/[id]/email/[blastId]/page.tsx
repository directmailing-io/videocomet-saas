import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth-guard";
import { getCampaign } from "@/lib/db/queries/campaigns";
import {
  countBlastMessages,
  getBlastEngagement,
  getEmailBlastForUser,
  listBlastMessages,
} from "@/lib/db/queries/email-blasts";
import { getMailboxConnection, serializeMailbox } from "@/lib/db/queries/mailboxes";
import { Button } from "@/components/ui/button";
import { BlastDetail, type BlastMessageItem } from "./blast-detail";

const PAGE_SIZE = 50;

export default async function EmailBlastDetailPage({
  params,
}: {
  params: Promise<{ id: string; blastId: string }>;
}) {
  const { id, blastId } = await params;
  const { user } = await requireUser();

  let campaign;
  try {
    campaign = await getCampaign(id, user.id);
  } catch {
    notFound();
  }

  const blast = await getEmailBlastForUser(blastId, user.id);
  if (!blast || blast.campaignId !== campaign.id) notFound();

  const mailboxIds = Array.from(
    new Set([blast.mailboxConnectionId, ...(blast.mailboxConnectionIds ?? [])]),
  );
  const [counts, engagement, mailboxRows, messagePage] = await Promise.all([
    countBlastMessages(blast.id),
    getBlastEngagement(blast.id),
    Promise.all(mailboxIds.map((mid) => getMailboxConnection(mid, user.id))),
    listBlastMessages(blast.id, { offset: 0, limit: PAGE_SIZE }),
  ]);

  const initialMessages: BlastMessageItem[] = messagePage.rows.map((r) => ({
    id: r.id,
    leadId: r.leadId,
    toEmail: r.toEmail,
    status: r.status,
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    repliedAt: r.repliedAt ? r.repliedAt.toISOString() : null,
    unsubscribedAt: r.unsubscribedAt ? r.unsubscribedAt.toISOString() : null,
    skipReason: r.skipReason,
    error: r.error,
    clicked: r.clicked,
    leadData: r.leadData,
    mailboxEmail: r.mailboxEmail,
    earliestSendAt: r.earliestSendAt ? r.earliestSendAt.toISOString() : null,
  }));

  const serializedMailboxes = mailboxRows
    .filter((m): m is NonNullable<typeof m> => Boolean(m))
    .map(serializeMailbox);

  return (
    <>
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/kampagnen/${campaign.id}?tab=email`}>
            <ArrowLeft className="size-4" />
            Zurück zur Kampagne
          </Link>
        </Button>
      </div>
      <BlastDetail
        campaignId={campaign.id}
        campaignName={campaign.name}
        initialBlast={{
          id: blast.id,
          status: blast.status,
          totalCount: blast.totalCount,
          sentCount: blast.sentCount ?? 0,
          failedCount: blast.failedCount ?? 0,
          skippedCount: blast.skippedCount ?? 0,
          bouncedCount: blast.bouncedCount ?? 0,
          repliedCount: blast.repliedCount ?? 0,
          pauseReason: blast.pauseReason ?? null,
          startedAt: blast.startedAt ? blast.startedAt.toISOString() : null,
          completedAt: blast.completedAt ? blast.completedAt.toISOString() : null,
          createdAt: blast.createdAt.toISOString(),
        }}
        initialCounts={counts}
        initialEngagement={engagement}
        mailboxes={serializedMailboxes.map((m) => ({
          emailAddress: m.emailAddress,
          status: m.status,
          effectiveDailyLimit: m.effectiveDailyLimit,
        }))}
        initialMessages={initialMessages}
        initialTotalMessages={messagePage.total}
        pageSize={PAGE_SIZE}
      />
    </>
  );
}
