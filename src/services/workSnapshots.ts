import { sourceDisplayTitle } from "./sourceTitles";
import { sourceService } from "./sources";
import { userDataService } from "./userData";
import type { SourceManga, WorkSnapshot } from "../types";

const snapshotJobs = new Map<string, Promise<void>>();

function sourceFromKey(key: string): SourceManga["source"] {
  if (key.startsWith("mt:")) return "mangatime";
  if (key.startsWith("tx:")) return "teamx";
  if (key.startsWith("aq:")) return "3asq";
  if (key.startsWith("sz:")) return "starzmanga";
  if (key.startsWith("xs:")) return "xsano";
  if (key.startsWith("ml:")) return "mangalik";
  if (key.startsWith("az:")) return "azora";
  return "mangalik";
}

export function snapshotToSourceManga(snapshot: WorkSnapshot): SourceManga {
  return {
    key: snapshot.mangaId,
    source: snapshot.source ?? sourceFromKey(snapshot.mangaId),
    sourceId: snapshot.mangaId.split(":").slice(1).join(":"),
    slug: snapshot.mangaId.split(":").slice(1).join(":"),
    type: "archived",
    url: snapshot.sourceUrl ?? "",
    title: snapshot.title,
    cover: snapshot.coverUrl ?? snapshot.originalCoverUrl ?? "",
    genres: [],
    chapters: [],
    status: "archived",
  };
}

export function saveWorkSnapshot(item: SourceManga, chapter?: number | null) {
  const scope = userDataService.captureAccountScope();
  if (!scope) return Promise.resolve();
  const jobKey = `${scope.key}:${item.key}:${chapter ?? "meta"}`;
  const existing = snapshotJobs.get(jobKey);
  if (existing) return existing;

  const job = (async () => {
    const result = await userDataService.saveWorkSnapshot({
      mangaId: item.key,
      title: sourceDisplayTitle(item),
      source: item.source,
      sourceUrl: item.url,
      coverUrl: item.cover || null,
      chapter: chapter ?? null,
    });

    scope.assertCurrent();
    if (!result.needsCover || !item.cover) return;

    const imageUrl = sourceService.imageUrl(item.source, item.cover, item.url);
    const response = await fetch(imageUrl, {
      signal: scope.signal,
      credentials: "include",
      cache: "no-store",
    });
    scope.assertCurrent();
    if (!response.ok) return;

    const blob = await response.blob();
    scope.assertCurrent();
    if (!blob.type.startsWith("image/") || !blob.size) return;
    await userDataService.saveWorkSnapshotCover(item.key, blob);
  })()
    .catch(() => {
      // Snapshotting is a safety layer and must never block reading.
    })
    .finally(() => {
      snapshotJobs.delete(jobKey);
    });

  snapshotJobs.set(jobKey, job);
  return job;
}

