import { manga } from "../data/mock";
import { useLibrary } from "../hooks/useLibrary";
import { MangaCard } from "../components/UI";
import { Link } from "react-router-dom";
export function Favorites() {
  const { data } = useLibrary();
  const items = manga.filter((item) => data?.favorites.includes(item.id));
  return (
    <>
      <p className="eyebrow">مكتبتك الخاصة</p>
      <h1>
        المفضلة<span className="accent">.</span>
      </h1>
      <p className="muted page-intro">
        {items.length} أعمال محفوظة عندك.
      </p>
      <div className="cover-grid">
        {items.map((item) => (
          <MangaCard key={item.id} item={item} detail />
        ))}
      </div>
      {!items.length && (
        <div className="empty">
          <h2>مفضلتك فاضية.</h2>
          <p>أضف عملا من الرئيسية أو خذ اقتراحا من أحد أصدقائك.</p>
          <Link className="primary" to="/">
            استعرض الأعمال ←
          </Link>
        </div>
      )}
    </>
  );
}
