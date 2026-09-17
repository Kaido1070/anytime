import { Link } from "react-router-dom";
import type { SourceManga } from "../types";
import { useLibrary } from "../hooks/useLibrary";
import { sourceService } from "../services/sources";
import { SourceCoverImage } from "./SourceCoverImage";

export function SourceCard({
  item,
  detail = false,
}: {
  item: SourceManga;
  detail?: boolean;
}) {
  const { data } = useLibrary();
  const progress = Object.values(data?.progress ?? {})
    .filter((entry) => entry.mangaId === item.key)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];

  return (
    <Link className="manga-card source-card" to={`/source/${encodeURIComponent(item.key)}`}>
      <div className="cover-wrap">
        {item.cover ? (
          <SourceCoverImage
            item={item}
            alt={`غلاف ${item.title}`}
            width="300"
            height="420"
            loading="lazy"
          />
        ) : (
          <div className="source-cover-placeholder">{item.title.slice(0, 1)}</div>
        )}
        <span className="cover-label">{sourceService.sourceLabel(item.source)}</span>
      </div>
      <h3 dir="auto">{item.title}</h3>
      <p>
        {detail
          ? progress
            ? `الفصل ${progress.chapter} · قرأت ${Math.round(progress.percent)}%`
            : "لم تبدأ بعد"
          : item.genres?.length
            ? item.genres.slice(0, 3).join(" · ")
            : sourceService.sourceLabel(item.source)}
      </p>
      {detail && item.latest != null && <small>آخر فصل {item.latest}</small>}
    </Link>
  );
}
