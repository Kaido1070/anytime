import { useEffect, useMemo, useState } from "react";
import { useLibrary } from "../hooks/useLibrary";
import { SourceCard } from "../components/SourceCard";
import { Link } from "react-router-dom";
import { mergeSourceItems } from "../services/sourceMerge";
import { sourceService } from "../services/sources";
import type { SourceManga } from "../types";

export function Favorites() {
  const { data } = useLibrary();
  const [items, setItems] = useState<SourceManga[]>([]);
  const keys = (data?.favorites ?? []).filter((id) => sourceService.isSourceKey(id));
  const groups = useMemo(() => mergeSourceItems(items), [items]);

  useEffect(() => {
    let active = true;
    if (!keys.length) {
      setItems([]);
      return;
    }
    sourceService
      .resolve(keys)
      .then((resolved) => active && setItems(resolved))
      .catch(() => active && setItems([]));
    return () => {
      active = false;
    };
  }, [keys.join("|")]);

  return (
    <>
      <p className="eyebrow">مكتبتك الخاصة</p>
      <h1>
        المفضلة<span className="accent">.</span>
      </h1>
      <p className="muted page-intro">{groups.length || keys.length} أعمال محفوظة عندك.</p>
      <div className="cover-grid">
        {groups.map((group) => (
          <SourceCard key={group.id} item={group.primary} sources={group.items} detail />
        ))}
      </div>
      {!keys.length && (
        <div className="empty">
          <h2>مفضلتك فاضية.</h2>
          <p>ابحث في MangaTime أو Team-X وأضف اللي تبيه.</p>
          <Link className="primary" to="/discover">
            استعرض الأعمال ←
          </Link>
        </div>
      )}
      {keys.length > items.length && (
        <p className="muted source-note">بعض الأعمال تعذر تحديث بياناتها من المصدر حاليا.</p>
      )}
    </>
  );
}
