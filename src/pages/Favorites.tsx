import { useEffect, useMemo, useState } from "react";
import { useLibrary } from "../hooks/useLibrary";
import { SourceCard } from "../components/SourceCard";
import { Link, useLocation } from "react-router-dom";
import { mergeSourceItems } from "../services/sourceMerge";
import { Back } from "../components/UI";
import { sourceService } from "../services/sources";
import type { SourceManga } from "../types";

export function Favorites() {
  const { data } = useLibrary();
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo || "/profile";
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
      <Back to={returnTo} />
      <p className="eyebrow">مكتبتك الخاصة</p>
      <h1>
        المفضلة<span className="accent">.</span>
      </h1>
      <p className="muted page-intro">{groups.length || keys.length} قصص محفوظة عندك.</p>
      <div className="cover-grid">
        {groups.map((group) => (
          <SourceCard key={group.id} item={group.primary} sources={group.items} detail />
        ))}
      </div>
      {!keys.length && (
        <div className="empty">
          <h2>مفضلتك فاضية.</h2>
          <p>ابحث في المصادر وأضف اللي تبيه.</p>
          <Link className="primary" to="/discover">
            استعرض القصص ←
          </Link>
        </div>
      )}
      {keys.length > items.length && (
        <p className="muted source-note">بعض القصص تعذر تحديث بياناتها من المصدر حاليا.</p>
      )}
    </>
  );
}
