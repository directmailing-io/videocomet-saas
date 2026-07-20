import { Library } from "lucide-react";
import { requireUser } from "@/lib/auth-guard";
import { listUserMedia, type MediaItem } from "@/lib/db/queries/media";
import { listShareLinksForUser } from "@/lib/db/queries/webcam-share";
import { listUserMediaUrls } from "@/lib/media-urls/repo";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { UploadDialogTrigger } from "./upload-zone";
import { ShareLinksSection, type ShareLinkRow } from "./share-links";
import { MediaCard, type MediaCardItem } from "./media-card";
import { type UrlCardItem } from "./url-card";
import { UrlAddDialog } from "./url-add-dialog";
import { UrlList } from "./url-list";

function toCardItem(m: MediaItem): MediaCardItem {
  return {
    id: m.id,
    type: m.type,
    name: m.name,
    publicUrl: m.publicUrl,
    durationSec: m.durationSec,
    bytes: m.bytes,
    createdAt: m.createdAt.toISOString(),
  };
}

function MediaGrid({ items }: { items: MediaItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Library />}
        title="Keine Einträge"
        subtitle="In diesem Bereich ist noch nichts hinterlegt."
      />
    );
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
      {items.map((m) => (
        <MediaCard key={m.id} item={toCardItem(m)} />
      ))}
    </div>
  );
}

export default async function MediathekPage() {
  const { user } = await requireUser();
  const [all, shareLinks, urls] = await Promise.all([
    listUserMedia(user.id),
    listShareLinksForUser(user.id),
    listUserMediaUrls(user.id),
  ]);
  const webcams = all.filter((m) => m.type === "webcam");
  const images = all.filter((m) => m.type === "image");
  const videos = all.filter((m) => m.type === "video");
  const logos = all.filter((m) => m.type === "logo");

  // URL-Items in Client-safen Shape umwandeln (Dates -> ISO).
  const urlItems: UrlCardItem[] = urls.map((u) => ({
    id: u.id,
    url: u.url,
    type: u.type,
    title: u.title,
    description: u.description,
    previewUrl: u.previewUrl,
    previewStatus: u.previewStatus,
    previewGeneratedAt: u.previewGeneratedAt
      ? u.previewGeneratedAt.toISOString()
      : null,
    previewExpiresAt: u.previewExpiresAt
      ? u.previewExpiresAt.toISOString()
      : null,
    lastError: u.lastError,
    createdAt: u.createdAt.toISOString(),
  }));

  // Owner-Anzeigename für die Vorschau im Dialog: Firma > Vor+Nachname > Email.
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  const ownerDisplayName =
    fullName || user.email.split("@")[0];
  const appOrigin = (process.env.APP_URL ?? "https://app.videocomet.de").replace(
    /\/+$/,
    "",
  );

  // Wir serialisieren die rohen DB-Rows in einen client-safen Shape
  // (Dates → ISO-Strings, Status berechnet).
  const now = Date.now();
  const initialLinks: ShareLinkRow[] = shareLinks.map((l) => {
    let status: ShareLinkRow["status"] = "open";
    if (l.revokedAt) status = "revoked";
    else if (l.usedAt) status = "used";
    else if (l.expiresAt && l.expiresAt.getTime() <= now) status = "expired";
    return {
      id: l.id,
      slug: l.slug,
      numericId: l.numericId,
      title: l.title,
      maxDurationSec: l.maxDurationSec,
      expiresAt: l.expiresAt ? l.expiresAt.toISOString() : null,
      usedAt: l.usedAt ? l.usedAt.toISOString() : null,
      mediaItemId: l.mediaItemId,
      revokedAt: l.revokedAt ? l.revokedAt.toISOString() : null,
      createdAt: l.createdAt.toISOString(),
      status,
      url: `${appOrigin}/r/${l.slug}`,
    };
  });

  return (
    <>
      <PageHeader
        title="Mediathek"
        subtitle="Verwalte Webcam-Aufnahmen, Bilder, Videos und Logos."
        actions={<UploadDialogTrigger />}
      />

      <Tabs defaultValue="alle">
        <TabsList>
          <TabsTrigger value="alle">Alle ({all.length})</TabsTrigger>
          <TabsTrigger value="webcam">Webcam ({webcams.length})</TabsTrigger>
          <TabsTrigger value="bilder">Bilder ({images.length})</TabsTrigger>
          <TabsTrigger value="videos">Videos ({videos.length})</TabsTrigger>
          <TabsTrigger value="logos">Logos ({logos.length})</TabsTrigger>
          <TabsTrigger value="links">Links ({urlItems.length})</TabsTrigger>
          <TabsTrigger value="share">
            Aufnahme-Links ({initialLinks.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="alle">
          <MediaGrid items={all} />
        </TabsContent>
        <TabsContent value="webcam">
          <MediaGrid items={webcams} />
        </TabsContent>
        <TabsContent value="bilder">
          <MediaGrid items={images} />
        </TabsContent>
        <TabsContent value="videos">
          <MediaGrid items={videos} />
        </TabsContent>
        <TabsContent value="logos">
          <MediaGrid items={logos} />
        </TabsContent>
        <TabsContent value="links">
          <div className="flex items-center justify-between gap-4 mb-6">
            <div className="text-sm text-ink-muted">
              Speichere Google Docs, Sheets oder beliebige Links. Wiederverwendbar
              in Kampagnen-Wizards.
            </div>
            <UrlAddDialog />
          </div>
          <UrlList items={urlItems} />
        </TabsContent>
        <TabsContent value="share">
          <ShareLinksSection
            ownerDisplayName={ownerDisplayName}
            appOrigin={appOrigin}
            initial={initialLinks}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
