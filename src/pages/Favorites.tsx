import { manga } from "../data/mock";
import { useLibrary } from "../hooks/useLibrary";
import { MangaCard } from "../components/UI";
import { Link } from "react-router-dom";
export function Favorites() {
  const { data } = useLibrary();
  const items = manga.filter((item) => data?.favorites.includes(item.id));
  return (
    <>
      <p className="eyebrow">YOUR PERSONAL SHELF</p>
      <h1>
        Favorites<span className="accent">.</span>
      </h1>
      <p className="muted page-intro">
        {items.length} stories worth coming back to.
      </p>
      <div className="cover-grid">
        {items.map((item) => (
          <MangaCard key={item.id} item={item} detail />
        ))}
      </div>
      {!items.length && (
        <div className="empty">
          <h2>Your shelf is waiting.</h2>
          <p>Find a story on Home or borrow inspiration from a friend.</p>
          <Link className="primary" to="/">
            Explore stories →
          </Link>
        </div>
      )}
    </>
  );
}
