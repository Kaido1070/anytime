import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useLibrary } from "../hooks/useLibrary";
import { Back, SectionTitle } from "../components/UI";
import { SourceCard } from "../components/SourceCard";
import { sourceService } from "../services/sources";
import type { SourceManga } from "../types";

function useFriendSourceItems(keys: string[]) {
  const [items, setItems] = useState<Record<string, SourceManga>>({});
  const signature = keys.join("|");

  useEffect(() => {
    let active = true;
    if (!keys.length) {
      setItems({});
      return;
    }
    sourceService
      .resolve(keys)
      .then((resolved) => {
        if (active) setItems(Object.fromEntries(resolved.map((item) => [item.key, item])));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [signature]);

  return items;
}

export function Friends({ embedded = false }: { embedded?: boolean }) {
  const { friends, addFriend } = useLibrary();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const sourceKeys = useMemo(() => {
    const set = new Set<string>();
    friends.forEach((friend) => {
      if (sourceService.isSourceKey(friend.reading?.mangaId)) set.add(friend.reading!.mangaId);
      friend.favorites.filter((id) => sourceService.isSourceKey(id)).forEach((id) => set.add(id));
    });
    return [...set];
  }, [friends]);
  const sourceItems = useFriendSourceItems(sourceKeys);

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
      {embedded ? (
        <header className="account-friends-header">
          <div>
            <p className="eyebrow">داخل حسابك</p>
            <h2>الأصدقاء</h2>
            <p className="muted page-intro">شوف وش يقرؤون وخذ من مفضلتهم.</p>
          </div>
        </header>
      ) : (
        <>
          <p className="eyebrow">القراءة أحلى مع الأصدقاء</p>
          <h1>
            الأصدقاء<span className="accent">.</span>
          </h1>
          <p className="muted page-intro">شوف وش يقرؤون وخذ من مفضلتهم.</p>
        </>
      )}

      <div className="login-form" style={{ maxWidth: 460, marginBottom: 28 }}>
        <form onSubmit={submit} style={{ marginTop: 0 }}>
          <label>
            إضافة صديق باسم المستخدم
            <input
              name="username"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
              placeholder="مثال: yas"
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
          const reading = friend.reading && sourceService.isSourceKey(friend.reading.mangaId)
            ? friend.reading
            : null;
          const current = reading ? sourceItems[reading.mangaId] : null;
          const favorites = friend.favorites
            .filter((id) => sourceService.isSourceKey(id))
            .map((id) => sourceItems[id]?.title)
            .filter(Boolean);

          return (
            <Link key={friend.user.id} to={`/friends/${friend.user.id}`} className="friend-row">
              <span className={`avatar large tone-${i}`}>{friend.user.name[0]}</span>
              <div>
                <h2>{friend.user.name}</h2>
                <small>{reading ? "يقرأ حاليا" : "ما بدأ قراءة بعد"}</small>
                {reading && current && (
                  <p dir="auto">
                    {current.title} · الفصل {reading.chapter}
                  </p>
                )}
                <small>
                  {favorites.length ? `آخر المفضلة: ${favorites.slice(0, 3).join(", ")}` : "المفضلة فارغة"}
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

  const sourceKeys = useMemo(() => {
    if (!friend) return [];
    const set = new Set<string>();
    if (sourceService.isSourceKey(friend.reading?.mangaId)) set.add(friend.reading!.mangaId);
    friend.favorites.filter((key) => sourceService.isSourceKey(key)).forEach((key) => set.add(key));
    return [...set];
  }, [friend]);
  const sourceItems = useFriendSourceItems(sourceKeys);

  if (!friend)
    return (
      <>
        <Back to="/profile#account-friends" />
        <h1>الصديق غير موجود</h1>
      </>
    );

  const friendId = friend.user.id;
  const reading = friend.reading && sourceService.isSourceKey(friend.reading.mangaId)
    ? friend.reading
    : null;
  const current = reading ? sourceItems[reading.mangaId] : null;
  const favoriteKeys = friend.favorites.filter((key) => sourceService.isSourceKey(key));

  async function remove() {
    setRemoving(true);
    setRemoveError("");
    try {
      await removeFriend(friendId);
      navigate("/profile#account-friends", { replace: true });
    } catch (cause) {
      setRemoveError(cause instanceof Error ? cause.message : "تعذر حذف الصديق.");
      setRemoving(false);
    }
  }

  return (
    <>
      <Back to="/profile#account-friends" />
      <div className="friend-heading">
        <span className="avatar large">{friend.user.name[0]}</span>
        <div>
          <p className="eyebrow">مكتبة صديقك</p>
          <h1>{friend.user.name}</h1>
        </div>
      </div>

      <SectionTitle title="يقرأ حاليا" />
      {reading && current ? (
        <Link className="update-row friend-current" to={`/source/${encodeURIComponent(current.key)}`}>
          {current.cover && (
            <img src={sourceService.imageUrl(current.source, current.cover)} alt="" />
          )}
          <div>
            <h2 dir="auto">{current.title}</h2>
            <p>الفصل {reading.chapter}</p>
          </div>
          <span>←</span>
        </Link>
      ) : (
        <p className="empty">ما عنده قراءة حالية.</p>
      )}

      <SectionTitle title="المفضلة" />
      <div className="cover-grid">
        {favoriteKeys.map((mangaId) => {
          const item = sourceItems[mangaId];
          if (!item) return null;
          const added = data?.favorites.includes(mangaId);
          return (
            <div key={mangaId}>
              <SourceCard item={item} />
              <button
                className="secondary copy-button"
                disabled={added}
                onClick={() => void favorite(mangaId, true)}
              >
                {added ? "✓ موجود في مفضلتك" : "أضف إلى مفضلتي"}
              </button>
            </div>
          );
        })}
      </div>
      {!favoriteKeys.length && <p className="empty">مفضلته فارغة.</p>}

      {removeError && <p className="error">{removeError}</p>}
      <button className="secondary signout" disabled={removing} onClick={() => void remove()}>
        {removing ? "جاري الحذف…" : "حذف من الأصدقاء"}
      </button>
    </>
  );
}
