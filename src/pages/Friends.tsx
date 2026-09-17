import { Link, useParams } from "react-router-dom";
import { useLibrary } from "../hooks/useLibrary";
import { findManga } from "../data/mock";
import { Back, MangaCard, SectionTitle } from "../components/UI";
export function Friends() {
  const { friends } = useLibrary();
  return (
    <>
      <p className="eyebrow">STORIES ARE BETTER SHARED</p>
      <h1>
        In good company<span className="accent">.</span>
      </h1>
      <p className="muted page-intro">
        A small circle. A whole world of stories.
      </p>
      <div className="friends-list">
        {friends.map((friend, i) => (
          <Link
            key={friend.user.id}
            to={`/friends/${friend.user.id}`}
            className="friend-row"
          >
            <span className={`avatar large tone-${i}`}>
              {friend.user.name[0]}
            </span>
            <div>
              <h2>{friend.user.name}</h2>
              <small>CURRENTLY READING</small>
              <p>
                {findManga(friend.reading.mangaId)?.title} · Ch.{" "}
                {friend.reading.chapter}
              </p>
              <small>
                Recent favorites:{" "}
                {friend.favorites.map((id) => findManga(id)?.title).join(", ")}
              </small>
            </div>
            <span>↗</span>
          </Link>
        ))}
      </div>
    </>
  );
}
export function FriendProfile() {
  const { id } = useParams();
  const { friends, data, favorite } = useLibrary();
  const friend = friends.find((item) => item.user.id === id);
  if (!friend)
    return (
      <>
        <Back to="/friends" />
        <h1>Friend not found</h1>
      </>
    );
  const current = findManga(friend.reading.mangaId)!;
  return (
    <>
      <Back to="/friends" />
      <div className="friend-heading">
        <span className="avatar large">{friend.user.name[0]}</span>
        <div>
          <p className="eyebrow">A FRIEND'S READING ROOM</p>
          <h1>{friend.user.name}</h1>
        </div>
      </div>
      <SectionTitle title="Currently reading" />
      <Link className="update-row friend-current" to={`/manga/${current.id}`}>
        <img src={current.cover} alt="" />
        <div>
          <h2>{current.title}</h2>
          <p>Chapter {friend.reading.chapter}</p>
        </div>
        <span>→</span>
      </Link>
      <SectionTitle title="Favorites" />
      <div className="cover-grid">
        {friend.favorites.map((id) => {
          const item = findManga(id)!;
          const added = data?.favorites.includes(id);
          return (
            <div key={id}>
              <MangaCard item={item} />
              <button
                className="secondary copy-button"
                disabled={added}
                onClick={() => favorite(id, true)}
              >
                {added ? "✓ In your favorites" : "Add to My Favorites"}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
