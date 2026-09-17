import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLibrary } from "../hooks/useLibrary";
import { findManga } from "../data/mock";
import { Back, MangaCard, SectionTitle } from "../components/UI";

export function Friends() {
  const { friends, addFriend } = useLibrary();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const username = String(form.get("username") ?? "");
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await addFriend(username);
      formElement.reset();
      setMessage("تمت إضافة الصديق.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إضافة الصديق.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="eyebrow">القراءة أحلى مع الأصدقاء</p>
      <h1>
        الأصدقاء<span className="accent">.</span>
      </h1>
      <p className="muted page-intro">شوف وش يقرؤون وخذ من مفضلتهم.</p>

      <div className="login-form" style={{ maxWidth: 460, marginBottom: 28 }}>
        <form onSubmit={submit} style={{ marginTop: 0 }}>
          <label>
            إضافة صديق باسم المستخدم
            <input
              name="username"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              placeholder="مثال: kaido"
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          {message && <p className="muted">{message}</p>}
          <button className="secondary" disabled={busy}>
            {busy ? "جاري الإضافة…" : "إضافة صديق"}
          </button>
        </form>
      </div>

      <div className="friends-list">
        {friends.map((friend, i) => {
          const current = friend.reading ? findManga(friend.reading.mangaId) : null;
          return (
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
                <small>{friend.reading ? "يقرأ حاليا" : "ما بدأ قراءة بعد"}</small>
                {friend.reading && current && (
                  <p>
                    {current.title} · الفصل {friend.reading.chapter}
                  </p>
                )}
                <small>
                  {friend.favorites.length
                    ? `آخر المفضلة: ${friend.favorites
                        .map((id) => findManga(id)?.title)
                        .filter(Boolean)
                        .join(", ")}`
                    : "المفضلة فارغة"}
                </small>
              </div>
              <span>↗</span>
            </Link>
          );
        })}
      </div>
      {!friends.length && <p className="empty">ما عندك أصدقاء مضافين حاليا.</p>}
    </>
  );
}

export function FriendProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { friends, data, favorite, removeFriend } = useLibrary();
  const [removeError, setRemoveError] = useState("");
  const [removing, setRemoving] = useState(false);
  const friend = friends.find((item) => item.user.id === id);

  if (!friend)
    return (
      <>
        <Back to="/friends" />
        <h1>الصديق غير موجود</h1>
      </>
    );

  const current = friend.reading ? findManga(friend.reading.mangaId) : null;

  async function remove() {
    if (!friend) return;
    setRemoving(true);
    setRemoveError("");
    try {
      await removeFriend(friend.user.id);
      navigate("/friends", { replace: true });
    } catch (cause) {
      setRemoveError(cause instanceof Error ? cause.message : "تعذر حذف الصديق.");
      setRemoving(false);
    }
  }

  return (
    <>
      <Back to="/friends" />
      <div className="friend-heading">
        <span className="avatar large">{friend.user.name[0]}</span>
        <div>
          <p className="eyebrow">مكتبة صديقك</p>
          <h1>{friend.user.name}</h1>
        </div>
      </div>

      <SectionTitle title="يقرأ حاليا" />
      {friend.reading && current ? (
        <Link className="update-row friend-current" to={`/manga/${current.id}`}>
          <img src={current.cover} alt="" />
          <div>
            <h2>{current.title}</h2>
            <p>الفصل {friend.reading.chapter}</p>
          </div>
          <span>←</span>
        </Link>
      ) : (
        <p className="empty">ما عنده قراءة حالية.</p>
      )}

      <SectionTitle title="المفضلة" />
      <div className="cover-grid">
        {friend.favorites.map((mangaId) => {
          const item = findManga(mangaId);
          if (!item) return null;
          const added = data?.favorites.includes(mangaId);
          return (
            <div key={mangaId}>
              <MangaCard item={item} />
              <button
                className="secondary copy-button"
                disabled={added}
                onClick={() => favorite(mangaId, true)}
              >
                {added ? "✓ موجود في مفضلتك" : "أضف إلى مفضلتي"}
              </button>
            </div>
          );
        })}
      </div>
      {!friend.favorites.length && <p className="empty">مفضلته فارغة.</p>}

      {removeError && <p className="error">{removeError}</p>}
      <button
        className="secondary signout"
        disabled={removing}
        onClick={() => void remove()}
      >
        {removing ? "جاري الحذف…" : "حذف من الأصدقاء"}
      </button>
    </>
  );
}
