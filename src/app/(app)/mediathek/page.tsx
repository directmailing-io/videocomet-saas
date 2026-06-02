import { Library, FileVideo, Image as ImageIcon, Film } from "lucide-react";
import { requireUser } from "@/lib/auth-guard";
import { listUserMedia, type MediaItem } from "@/lib/db/queries/media";
import { PageHeader } from "@/components/ui/page-header";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Eye, Trash2 } from "lucide-react";
import { UploadDialogTrigger } from "./upload-zone";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "0 KB";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDuration(sec: number | null): string | null {
  if (!sec || sec <= 0) return null;
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(d: Date | null): string {
  if (!d) return "";
  try {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(d));
  } catch {
    return "";
  }
}

function typeIcon(type: string) {
  if (type === "image") return <ImageIcon className="size-6 text-ink-muted" />;
  if (type === "video") return <Film className="size-6 text-ink-muted" />;
  if (type === "logo") return <ImageIcon className="size-6 text-ink-muted" />;
  return <FileVideo className="size-6 text-ink-muted" />;
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
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {items.map((m) => (
        <Card key={m.id} hover>
          <CardContent className="p-3">
            <div className="relative aspect-square rounded-squircle-sm bg-surface-muted mb-3 flex items-center justify-center overflow-hidden">
              {m.type === "image" || m.type === "logo" ? (
                <img
                  src={m.publicUrl}
                  alt={m.name}
                  className="w-full h-full object-cover"
                />
              ) : m.type === "video" || m.type === "webcam" ? (
                <>
                  <video
                    src={m.publicUrl}
                    controls
                    preload="metadata"
                    playsInline
                    className="w-full h-full object-cover bg-black"
                  />
                  {formatDuration(m.durationSec) && (
                    <span className="pointer-events-none absolute top-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white tabular-nums">
                      {formatDuration(m.durationSec)}
                    </span>
                  )}
                </>
              ) : (
                typeIcon(m.type)
              )}
            </div>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink truncate">
                  {m.name}
                </p>
                <p className="text-xs text-ink-muted">
                  {formatBytes(m.bytes)} . {formatDate(m.createdAt)}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex size-7 items-center justify-center rounded-full hover:bg-line-soft transition-colors"
                    aria-label="Aktionen"
                  >
                    <MoreHorizontal className="size-4 text-ink-muted" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <a href={m.publicUrl} target="_blank" rel="noreferrer">
                      <Eye className="size-4 text-ink-muted" />
                      Vorschau
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem danger>
                    <Trash2 className="size-4" />
                    Löschen
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default async function MediathekPage() {
  const { user } = await requireUser();
  const all = await listUserMedia(user.id);
  const webcams = all.filter((m) => m.type === "webcam");
  const images = all.filter((m) => m.type === "image");
  const videos = all.filter((m) => m.type === "video");
  const logos = all.filter((m) => m.type === "logo");

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
      </Tabs>
    </>
  );
}
