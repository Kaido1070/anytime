import { useEffect, useState, type ImgHTMLAttributes } from "react";
import type { SourceManga } from "../types";
import { sourceService } from "../services/sources";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  item: SourceManga;
};

export function SourceCoverImage({ item, onError, ...props }: Props) {
  const [covers, setCovers] = useState<string[]>(item.cover ? [item.cover] : []);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let active = true;
    setCovers(item.cover ? [item.cover] : []);
    setIndex(0);

    if (item.source === "mangatime" || item.source === "3asq" || item.source === "starzmanga" || item.source === "xsano") {
      void sourceService.coverCandidates(item).then((next) => {
        if (!active || !next.length) return;
        setCovers(next);
        setIndex(0);
      });
    }

    return () => {
      active = false;
    };
  }, [item.key, item.cover, item.source]);

  const cover = covers[index] ?? item.cover;
  if (!cover) return null;

  return (
    <img
      {...props}
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
