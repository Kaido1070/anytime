import { useEffect, useState } from "react";
import { manga } from "../data/mock";
import { useLibrary } from "../hooks/useLibrary";
import { MangaCard } from "../components/UI";
import { SourceCard } from "../components/SourceCard";
import { Link } from "react-router-dom";
import { sourceService } from "../services/sources";
import type { SourceManga } from "../types";

export function Favorites() {
  const { data } = useLibrary();
  const [sourceItems, setSourceItems] = useState<SourceManga[]>([]);
  const sourceKeys = (data?.favorites ?? []).filter((id) => sourceService.isSourceKey(id));
  const staticItems = manga.filter((item) => data?.favorites.includes(item.id));

  useEffect(() => {
    let active = true;
    if (!sourceKeys.length) {
      setSourceItems([]);
      return;
    }
    sourceService
      .resolve(sourceKeys)
      .then((items) => active && setSourceItems(items))
      .catch(() => active && setSourceItems([]));
    return () => {
      active = false;
    };
  }, [sourceKeys.join("|")]);

  const total = data?.favorites.length ?? 0;

  return (
    <>
      <p className="eyebrow">مكتبتك الخاصة</p>
      <h1>
        المفضلة<span className="accent">.</span>
      </h1>
      <p className="muted page-intro">{total} أعمال محفوظة عندك.</p>
      <div className="cover-grid">
        {sourceItems.map((item) => (
          <SourceCard key={item.key} item={item} detail />
        ))}
        {staticItems.map((item) => (
          <MangaCard key={item.id} item={item} detail />
        ))}
      </div>
      {!total && (
        <div className="empty">
          <h2>مفضلتك فاضية.</h2>
          <p>ابحث في MangaTime أو Team-X وأضف اللي تبيه.</p>
          <Link className="primary" to="/discover">
            استعرض الأعمال ←
          </Link>
        </div>
      )}
      {sourceKeys.length > sourceItems.length && (
        <p className="muted source-note">بعض عناصر المصدر تحتاج فتحها مرة واحدة حتى تتحدث بياناتها.</p>
      )}
    </>
  );
}
