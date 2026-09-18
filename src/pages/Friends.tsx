import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useLibrary } from "../hooks/useLibrary";
import { Back, SectionTitle } from "../components/UI";
import { SourceCoverImage } from "../components/SourceCoverImage";
import { sourceDisplayTitle } from "../services/sourceTitles";
import { sourceService } from "../services/sources";
import { userDataService } from "../services/userData";
import type {
  LibraryStatus,
  ProfileLibraryItem,
  ProfileListPreview,
  SourceManga,
  User,
  UserProfileView,
} from "../types";

const PROFILE_PREVIEW_LIMIT = 8;

const libraryStatusLabels: Record<LibraryStatus, string> = {
  reading: "يقرأ حاليًا",
  completed: "مكتمل",
  paused: "متوقف",
  planned: "مخطط له",
};

function useSourceItems(keys: string[]) {
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
      .catch(() => {
        if (active) setItems({});
      });
    return () => {
      active = false;
    };
  }, [signature]);

  return items;
}

function ProfileWorkStrip({
  keys,
  works,
  meta,
  emptyText,
}: {
  keys: string[];
  works: Record<string, SourceManga>;
  meta?: (key: string) => string | null;
  emptyText: string;
}) {
  if (!keys.length) return <p className="profile-module-empty">{emptyText}</p>;

  return (
    <div className="profile-work-strip">
      {keys.map((key) => {
        const item = works[key];
        if (!item) return null;
        const title = sourceDisplayTitle(item);
        const detail = meta?.(key);
        return (
          <Link
            className="profile-work-card"
            to={`/source/${encodeURIComponent(item.key)}`}
            key={key}
          >
            <span className="profile-work-cover">
              {item.cover ? (
                <SourceCoverImage item={item} alt={`غلاف ${title}`} loading="lazy" />
              ) : (
                <span className="source-cover-placeholder">{title.slice(0, 1)}</span>
              )}
            </span>
            <b dir="auto">{title}</b>
            <small>{detail || sourceService.sourceLabel(item.source)}</small>
          </Link>
        );
      })}
    </div>
  );
}

function FavoritesSection({
  profile,
  works,
}: {
  profile: UserProfileView;
  works: Record<string, SourceManga>;
}) {
  return (
    <section className="profile-module">
      <div className="profile-module-heading">
        <h2>المفضلة</h2>
        <span className="profile-module-count">{profile.favoriteCount} عمل</span>
      </div>
      <ProfileWorkStrip
        keys={profile.favorites}
        works={works}
        emptyText="لا توجد أعمال في المفضلة."
      />
    </section>
  );
}

function LibrarySection({
  entries,
  works,
}: {
  entries: ProfileLibraryItem[];
  works: Record<string, SourceManga>;
}) {
  return (
    <section className="profile-module">
      <div className="profile-module-heading">
        <h2>الأعمال التي يتابعها</h2>
      </div>
      {!entries.length ? (
        <p className="profile-module-empty">لا توجد أعمال في المكتبة حتى الآن.</p>
      ) : (
        <div className="profile-library-groups">
          {(["reading", "completed", "paused", "planned"] as LibraryStatus[]).map((status) => {
            const statusEntries = entries.filter((entry) => entry.status === status);
            if (!statusEntries.length) return null;
            const byKey = new Map(statusEntries.map((entry) => [entry.mangaId, entry]));
            return (
              <div className="profile-library-group" key={status}>
                <div className="profile-library-group-heading">
                  <h3>{libraryStatusLabels[status]}</h3>
                  <span>{statusEntries.length}</span>
                </div>
                <ProfileWorkStrip
                  keys={statusEntries.map((entry) => entry.mangaId)}
                  works={works}
                  emptyText=""
                  meta={(key) => {
                    const chapter = byKey.get(key)?.highestReachedChapter;
                    return chapter == null ? libraryStatusLabels[status] : `وصل إلى الفصل ${chapter}`;
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ListSection({
  list,
  works,
}: {
  list: ProfileListPreview;
  works: Record<string, SourceManga>;
}) {
  return (
    <section className="profile-module">
      <div className="profile-module-heading">
        <div className="profile-list-heading-copy">
          <h2>{list.name}</h2>
          {list.description && <p className="muted">{list.description}</p>}
        </div>
        <Link to={`/lists/${encodeURIComponent(list.id)}`}>
          عرض القائمة <span aria-hidden="true">↗</span>
        </Link>
      </div>
      <ProfileWorkStrip
        keys={list.previewItems}
        works={works}
        emptyText="لا توجد أعمال في هذه القائمة حتى الآن."
      />
    </section>
  );
}

function PublicFriendsSection({ friends }: { friends: User[] }) {
  return (
    <section className="profile-module profile-public-friends">
      <div className="profile-module-heading">
        <h2>الأصدقاء</h2>
        <span className="profile-module-count">{friends.length ? "معاينة" : ""}</span>
      </div>
      {friends.length ? (
        <div className="profile-friends-strip">
          {friends.map((friend, index) => (
            <Link to={`/friends/${friend.id}`} className="profile-friend-card" key={friend.id}>
              <span className={`avatar tone-${index % 3}`}>{friend.name.slice(0, 1)}</span>
              <span>
                <b>{friend.name}</b>
                <small>@{friend.username}</small>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="profile-module-empty">لا يوجد أصدقاء حتى الآن.</p>
      )}
    </section>
  );
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
  const sourceItems = useSourceItems(sourceKeys);

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
            <p className="muted page-intro">شوف ملفات أصدقائك حسب إعدادات الخصوصية.</p>
          </div>
        </header>
      ) : (
        <>
          <p className="eyebrow">القراءة أحلى مع الأصدقاء</p>
          <h1>
            الأصدقاء<span className="accent">.</span>
          </h1>
          <p className="muted page-intro">شوف ملفات أصدقائك حسب إعدادات الخصوصية.</p>
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
          const isPrivate = friend.user.profileVisibility === "private";
          const reading =
            !isPrivate && friend.reading && sourceService.isSourceKey(friend.reading.mangaId)
              ? friend.reading
              : null;
          const current = reading ? sourceItems[reading.mangaId] : null;
          const favorites = friend.favorites
            .filter((id) => sourceService.isSourceKey(id))
            .map((id) => sourceItems[id]?.title)
            .filter(Boolean);

          return (
            <Link key={friend.user.id} to={`/friends/${friend.user.id}`} className="friend-row">
              <span className={`avatar large tone-${i % 3}`}>{friend.user.name[0]}</span>
              <div>
                <h2>{friend.user.name}</h2>
                <small>
                  {isPrivate ? "حساب خاص" : reading ? "يقرأ حاليًا" : "لا توجد قراءة حالية"}
                </small>
                {reading && current && (
                  <p dir="auto">
                    {sourceDisplayTitle(current)} · وصل إلى الفصل {reading.chapter}
                  </p>
                )}
                <small>
                  {favorites.length
                    ? `من المفضلة: ${favorites.slice(0, 3).join(", ")}`
                    : "المفضلة فارغة"}
                </small>
              </div>
              <span>↗</span>
            </Link>
          );
        })}
      </div>
      {!friends.length && <p className="empty">ما عندك أصدقاء مضافين حاليًا.</p>}
    </>
  );
}

export function FriendProfile() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { user, friends, data, favorite, removeFriend } = useLibrary();
  const [profile, setProfile] = useState<UserProfileView | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [removeError, setRemoveError] = useState("");
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    let active = true;
    if (!id || id === user?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setPageError("");
    userDataService
      .getUserProfile(id, PROFILE_PREVIEW_LIMIT)
      .then((next) => {
        if (active) setProfile(next);
      })
      .catch((cause) => {
        if (active) {
          setProfile(null);
          setPageError(cause instanceof Error ? cause.message : "تعذر تحميل الحساب.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, user?.id]);

  const sourceKeys = useMemo(() => {
    if (!profile) return [];
    const set = new Set<string>();
    profile.favorites.forEach((key) => {
      if (sourceService.isSourceKey(key)) set.add(key);
    });
    profile.library?.forEach((entry) => {
      if (sourceService.isSourceKey(entry.mangaId)) set.add(entry.mangaId);
    });
    profile.lists?.forEach((list) => {
      list.previewItems.forEach((key) => {
        if (sourceService.isSourceKey(key)) set.add(key);
      });
    });
    return [...set];
  }, [profile]);
  const sourceItems = useSourceItems(sourceKeys);

  if (id === user?.id) return <Navigate to="/profile" replace />;

  if (loading) {
    return (
      <>
        <Back to="/profile#account-friends" />
        <div className="profile-view-loading" aria-label="جاري تحميل الحساب">
          <span />
          <span />
          <span />
        </div>
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <Back to="/profile#account-friends" />
        <h1>الحساب غير موجود</h1>
        {pageError && <p className="muted">{pageError}</p>}
      </>
    );
  }

  const profileUserId = profile.user.id;
  const isPrivate = profile.access === "private";
  const isFriend = friends.some((friend) => friend.user.id === profileUserId);
  const listById = new Map((profile.lists ?? []).map((list) => [list.id, list]));

  async function remove() {
    if (!isFriend) return;
    setRemoving(true);
    setRemoveError("");
    try {
      await removeFriend(profileUserId);
      navigate("/profile#account-friends", { replace: true });
    } catch (cause) {
      setRemoveError(cause instanceof Error ? cause.message : "تعذر حذف الصديق.");
      setRemoving(false);
    }
  }

  return (
    <>
      <Back to="/profile#account-friends" />

      <header className="profile-view-header">
        <div className="profile-view-identity">
          <span className="avatar profile-view-avatar">{profile.user.name.slice(0, 1)}</span>
          <div>
            <p className="eyebrow">{isPrivate ? "حساب خاص" : "ملف المستخدم"}</p>
            <h1>{profile.user.name}</h1>
            <p className="muted">@{profile.user.username}</p>
          </div>
        </div>

        {isPrivate ? (
          <span className="profile-private-badge">حساب خاص</span>
        ) : (
          profile.stats && (
            <div className="profile-view-stats" aria-label="إحصائيات الحساب">
              <span><b>{profile.stats.works}</b><small>عمل</small></span>
              <span><b>{profile.stats.completed}</b><small>مكتمل</small></span>
              <span><b>{profile.stats.lists}</b><small>قائمة</small></span>
              <span><b>{profile.stats.friends}</b><small>صديق</small></span>
            </div>
          )
        )}
      </header>

      {isPrivate ? (
        <FavoritesSection profile={profile} works={sourceItems} />
      ) : (
        <>
          <div className="profile-public-modules">
            {(profile.sections ?? []).map((section) => {
              if (section.type === "favorites") {
                return <FavoritesSection key={section.key} profile={profile} works={sourceItems} />;
              }
              if (section.type === "library") {
                return (
                  <LibrarySection
                    key={section.key}
                    entries={profile.library ?? []}
                    works={sourceItems}
                  />
                );
              }
              const list = section.referenceId ? listById.get(section.referenceId) : null;
              return list ? <ListSection key={section.key} list={list} works={sourceItems} /> : null;
            })}
          </div>

          {!profile.lists?.length && (
            <section className="profile-module">
              <SectionTitle title="القوائم" />
              <p className="profile-module-empty">لا توجد قوائم شخصية حتى الآن.</p>
            </section>
          )}

          <PublicFriendsSection friends={profile.friends ?? []} />
        </>
      )}

      {removeError && <p className="error">{removeError}</p>}
      {isFriend && (
        <button className="secondary signout" disabled={removing} onClick={() => void remove()}>
          {removing ? "جاري الحذف…" : "حذف من الأصدقاء"}
        </button>
      )}
    </>
  );
}
