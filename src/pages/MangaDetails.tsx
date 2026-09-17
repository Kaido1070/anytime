import { Link, useParams } from "react-router-dom";
import { findManga } from "../data/mock";
import { useLibrary } from "../hooks/useLibrary";
import { Back, Icon } from "../components/UI";
export function MangaDetails() {
  const { id = "" } = useParams();
  const item = findManga(id);
  const { data, favorite } = useLibrary();
  if (!item)
    return (
      <>
        <Back />
        <h1>Story not found</h1>
      </>
    );
  const saved = Object.values(data?.progress ?? {})
    .filter((p) => p.mangaId === id)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const chapter = saved?.chapter ?? item.chapters[item.chapters.length - 1];
  const isFavorite = data?.favorites.includes(id);
  return (
    <>
      <Back />
      <div className="details-hero">
        <img
          className="detail-cover"
          src={item.cover}
          alt={`${item.title} placeholder cover`}
        />
        <div>
          <p className="eyebrow">{item.status} · MANHWA</p>
          <h1>{item.title}</h1>
          {item.alternative && (
            <p className="alternative">{item.alternative}</p>
          )}
          <div className="genres">
            {item.genres.map((genre) => (
              <span key={genre}>{genre}</span>
            ))}
          </div>
          <p className="description">{item.description}</p>
          <div className="detail-actions">
            <Link className="primary" to={`/read/${id}/${chapter}`}>
              {saved ? "Continue reading" : "Start reading"}{" "}
              <Icon name="arrow" />
            </Link>
            <button
              className="secondary"
              aria-pressed={isFavorite}
              onClick={() => favorite(id)}
            >
              <Icon name={isFavorite ? "check" : "favorites"} />
              {isFavorite ? "Favorited" : "Favorite"}
            </button>
          </div>
        </div>
      </div>
      <div className="section-title">
        <h2>Chapters</h2>
        <span className="muted">{item.chapters.length} sample chapters</span>
      </div>
      <div className="chapter-list">
        {item.chapters.map((number) => {
          const key = `${id}:${number}`;
          const progress = data?.progress[key];
          const done = data?.completed.includes(key);
          return (
            <Link
              key={number}
              to={`/read/${id}/${number}`}
              className={progress && !done ? "reading" : ""}
            >
              <span className="chapter-number">
                {String(number).padStart(3, "0")}
              </span>
              <div>
                <h3>Chapter {number}</h3>
                <small>
                  {done
                    ? "Completed"
                    : progress
                      ? `Currently reading · ${Math.round(progress.percent)}%`
                      : "Unread"}
                </small>
              </div>
              {done ? <Icon name="check" /> : <Icon name="arrow" />}
            </Link>
          );
        })}
      </div>
    </>
  );
}
