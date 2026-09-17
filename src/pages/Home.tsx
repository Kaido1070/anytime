import { Link } from "react-router-dom";
import { useLibrary } from "../hooks/useLibrary";
import { manga, findManga } from "../data/mock";
import { MangaCard, SectionTitle, Progress, Icon } from "../components/UI";
export function Home() {
  const { user, data, friends } = useLibrary();
  const last = data?.lastOpened;
  const current = findManga(last?.mangaId ?? "returner") ?? manga[0];
  const chapter = last?.chapter ?? 143;
  const percent = data?.progress[`${current.id}:${chapter}`]?.percent ?? 0;
  return (
    <>
      <div className="greeting">
        <p className="eyebrow">MAKE A LITTLE TIME</p>
        <h1>
          Welcome back, {user?.name}
          <span className="accent">.</span>
        </h1>
        <p className="muted">Your next chapter is waiting.</p>
      </div>
      <SectionTitle title="Continue reading" />
      <section className="continue-card">
        <Link className="continue-cover" to={`/manga/${current.id}`}>
          <img src={current.cover} alt={`${current.title} placeholder cover`} />
        </Link>
        <div className="continue-copy">
          <p className="eyebrow">RIGHT WHERE YOU LEFT OFF</p>
          <Link to={`/manga/${current.id}`}>
            <h2>{current.title}</h2>
          </Link>
          <p className="muted">
            Chapter {chapter} <span className="dot-separator">·</span>{" "}
            {current.genres[0]}
          </p>
          <div className="progress-meta">
            <span>Your progress</span>
            <b>{Math.round(percent)}%</b>
          </div>
          <Progress value={percent} />
          <Link className="primary" to={`/read/${current.id}/${chapter}`}>
            Continue reading <Icon name="arrow" />
          </Link>
        </div>
      </section>
      <section>
        <SectionTitle title="Latest updates" />
        <div className="updates">
          {manga.slice(0, 3).map((item, i) => (
            <Link key={item.id} className="update-row" to={`/manga/${item.id}`}>
              <img src={item.cover} alt="" />
              <div>
                <small>{i === 0 ? "JUST UPDATED" : `${i + 1} HOURS AGO`}</small>
                <h3>{item.title}</h3>
                <p>Chapter {item.latest}</p>
              </div>
              <span className="update-dot" />
            </Link>
          ))}
        </div>
      </section>
      <section>
        <SectionTitle title="Your favorites" to="/favorites" />
        <div className="cover-grid home-grid">
          {manga
            .filter((item) => data?.favorites.includes(item.id))
            .map((item) => (
              <MangaCard key={item.id} item={item} />
            ))}
        </div>
        {!data?.favorites.length && (
          <p className="empty">
            A good story deserves a place here. Add a favorite from its details
            page.
          </p>
        )}
      </section>
      <section>
        <SectionTitle title="In good company" to="/friends" label="Friends" />
        <div className="activity">
          {friends.map((friend, i) => (
            <Link to={`/friends/${friend.user.id}`} key={friend.user.id}>
              <span className={`avatar tone-${i}`}>{friend.user.name[0]}</span>
              <div>
                <p>
                  <b>{friend.user.name}</b>{" "}
                  {friend.user.id === "ahmed"
                    ? "added Solo Leveling to favorites"
                    : `continued ${findManga(friend.reading.mangaId)?.title}`}
                </p>
                <small>
                  {friend.user.id === "ahmed"
                    ? "A new story on the shelf"
                    : `Chapter ${friend.reading.chapter}`}{" "}
                  · {i + 1}h ago
                </small>
              </div>
              <span aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>
      </section>
      <footer className="page-footer">
        A quiet corner. A good story. Anytime.
      </footer>
    </>
  );
}
