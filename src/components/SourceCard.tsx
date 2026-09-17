import { Link } from "react-router-dom";
import type { SourceManga } from "../types";
import { useLibrary } from "../hooks/useLibrary";
import { sourceDisplayTitle } from "../services/sourceTitles";
import { sourceDetailsPath } from "../services/sourceMerge";
import { sourceService } from "../services/sources";
import { SourceCoverImage } from "./SourceCoverImage";

export function SourceCard({
  item,
  detail = false,
  sources,
}: {
  item: SourceManga;
  detail?: boolean;
  sources?: SourceManga[];
}) {
  const { data } = useLibrary();
  const groupedItems = sources?.length ? sources : [item];
  const groupedKeys = new Set(groupedItems.map((entry) => entry.key));
  const progress = Object.values(data?.progress ?? {})
    .filter((entry) => groupedKeys.has(entry.mangaId))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const linkedItem = progress
    ? groupedItems.find((entry) => entry.key === progress.mangaId) ?? item
    : item;
  const displayTitle = sourceDisplayTitle(item);
  const sourceNames = [...new Set(groupedItems.map((entry) => sourceService.sourceLabel(entry.source)))];
  const merged = sourceNames.length > 1;

  return (
    <Link className="manga-card source-card" to={sourceDetailsPath(linkedItem.key, groupedItems)}>
      <div className="cover-wrap">
        {item.cover ? (
          <SourceCoverImage
            item={item}
            alt={`غلاف ${displayTitle}`}
            width="300"
            height="420"
            loading="lazy"
          />
        ) : (
          <div className="source-cover-placeholder">{item.title.slice(0, 1)}</div>
        )}
        <span className="cover-label" title={sourceNames.join(" + ")}>
          {merged ? `${sourceNames.length} مصادر` : sourceNames[0]}
        </span>
      </div>
      <h3 dir="auto">{displayTitle}</h3>
      <p>
        {detail
          ? progress
            ? `الفصل ${progress.chapter} · قرأت ${Math.round(progress.percent)}%`
            : "لم تبدأ بعد"
          : item.genres?.length
            ? item.genres.slice(0, 3).join(" · ")
            : merged
              ? sourceNames.join(" + ")
              : sourceNames[0]}
      </p>
      {detail && item.latest != null && <small>آخر فصل {item.latest}</small>}
    </Link>
  );
}
