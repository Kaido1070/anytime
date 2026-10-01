import { useEffect, useState, type ImgHTMLAttributes } from "react";
import type { SourceManga } from "../types";
import { sourceService } from "../services/sources";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  item: SourceManga;
};

export function SourceCoverImage({ item, onError, className, ...props }: Props) {
  const initialCovers = sourceService.coverFallbackCandidates(item);
  const [covers, setCovers] = useState<string[]>(initialCovers);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let active = true;
    const fallback = sourceService.coverFallbackCandidates(item);
    setCovers(fallback);
    setIndex(0);

    void sourceService.coverCandidates(item).then((next) => {
      if (!active || !next.length) return;
      setCovers(next);
      setIndex(0);
    });

    return () => {
      active = false;
    };
  }, [item.key, item.cover, item.source]);

  const cover = covers[index] ?? item.cover;
  if (!cover) return null;

  return (
    <img
      {...props}
      className={[className, item.source === "azora" ? "azora-source-cover" : ""].filter(Boolean).join(" ")}
      src={sourceService.imageUrl(item.source, cover)}
      onError={(event) => {
        if (index + 1 < covers.length) {
          setIndex((current) => current + 1);
          return;
        }
        onError?.(event);
      }}
    />
  );
}
