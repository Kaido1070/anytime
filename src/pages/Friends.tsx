import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import {
  ProfileActivitySection,
  ProfileIdentityHeader,
  ProfileListsSection,
  ProfileOverviewSkeleton,
  ProfileReadingSection,
  ProfileStatsSection,
} from "../components/ProfileOverview";
import { useLibrary } from "../hooks/useLibrary";
import { Back } from "../components/UI";
import { SourceCoverImage } from "../components/SourceCoverImage";
import { UserAvatar } from "../components/UserAvatar";
import { sourceDisplayTitle } from "../services/sourceTitles";
import { sourceService } from "../services/sources";
import { userDataService } from "../services/userData";
import type {
  FriendRelationship,
  FriendRequests,
  FriendSearchResult,
  SourceManga,
  User,
  UserProfileView,
} from "../types";

const PROFILE_PREVIEW_LIMIT = 4;

const emptyRequests: FriendRequests = {
  incoming: [],
  outgoing: [],
  incomingCount: 0,
  outgoingCount: 0,
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
        <span className="profile-module-count">{profile.favoriteCount} قصص</span>
      </div>
      <ProfileWorkStrip
        keys={profile.favorites}
        works={works}
        emptyText="لا توجد قصص في المفضلة."
      />
    </section>
  );
}

function PublicFriendsSection({ friends }: { friends: User[] }) {
  return (
    <section className="profile-module profile-public-friends" id="profile-public-friends">
      <div className="profile-module-heading">
        <h2>الأصدقاء</h2>
        <span className="profile-module-count">{friends.length ? "معاينة" : ""}</span>
      </div>
      {friends.length ? (
        <div className="profile-friends-strip">
          {friends.map((friend, index) => (
            <Link to={`/friends/${friend.id}`} className="profile-friend-card" key={friend.id}>
              <UserAvatar user={friend} className={`tone-${index % 3}`} />
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

function RelationshipActions({
  relationship,
  busy,
  onSend,
  onAccept,
  onReject,
  onCancel,
  onRemove,
}: {
  relationship: FriendRelationship;
  busy: boolean;
  onSend?: () => void;
  onAccept?: () => void;
  onReject?: () => void;
  onCancel?: () => void;
  onRemove?: () => void;
}) {
  if (relationship === "none") {
    return (
      <button className="primary friend-action-primary" disabled={busy} onClick={onSend}>
        {busy ? "جاري الإرسال…" : "إضافة صديق"}
      </button>
    );
  }

  if (relationship === "pending_sent") {
    return (
      <div className="friend-action-group">
        <span className="friend-status-chip">تم إرسال الطلب</span>
        <button className="secondary friend-action-small" disabled={busy} onClick={onCancel}>
          {busy ? "جاري الإلغاء…" : "إلغاء"}
        </button>
      </div>
    );
  }

  if (relationship === "pending_received") {
    return (
      <div className="friend-action-group">
        <button className="primary friend-action-small" disabled={busy} onClick={onAccept}>
          قبول
        </button>
        <button className="secondary friend-action-small" disabled={busy} onClick={onReject}>
          رفض
        </button>
      </div>
    );
  }

  return (
    <div className="friend-action-group">
      <span className="friend-status-chip">✓ صديق</span>
      {onRemove && (
        <button className="secondary friend-action-small" disabled={busy} onClick={onRemove}>
          إزالة من الأصدقاء
        </button>
      )}
    </div>
  );
}

export function Friends({ embedded = false }: { embedded?: boolean }) {
  const {
    friends,
    refreshFriends,
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    cancelFriendRequest,
  } = useLibrary();
  const [tab, setTab] = useState<"friends" | "requests" | "search">("friends");
  const [requests, setRequests] = useState<FriendRequests>(emptyRequests);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [requestsError, setRequestsError] = useState("");
  const [friendsError, setFriendsError] = useState("");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FriendSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [busyUserId, setBusyUserId] = useState("");

  async function loadRequests() {
    setRequestsError("");
    setRequestsLoading(true);
    try {
      setRequests(await userDataService.getFriendRequests());
    } catch (cause) {
      setRequestsError(cause instanceof Error ? cause.message : "تعذر تحميل طلبات الصداقة.");
    } finally {
      setRequestsLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    refreshFriends().catch((cause) => {
      if (active) {
        setFriendsError(cause instanceof Error ? cause.message : "تعذر تحميل الأصدقاء.");
      }
    });
    void loadRequests();
    return () => {
      active = false;
    };
  }, [refreshFriends]);

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = query.trim();
    setSearchDone(true);
    setSearchError("");
    if (!normalized) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      setSearchResults(await userDataService.searchUsers(normalized));
    } catch (cause) {
      setSearchError(cause instanceof Error ? cause.message : "تعذر البحث عن المستخدمين.");
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }

  function updateSearchRelationship(userId: string, relationship: FriendRelationship) {
    setSearchResults((current) =>
      current.map((item) =>
        item.user.id === userId ? { ...item, relationship } : item,
      ),
    );
  }

  function removeRequestLocally(userId: string, direction: "incoming" | "outgoing") {
    setRequests((current) => {
      if (direction === "incoming") {
        return {
          ...current,
          incoming: current.incoming.filter((request) => request.user.id !== userId),
          incomingCount: Math.max(0, current.incomingCount - 1),
        };
      }
      return {
        ...current,
        outgoing: current.outgoing.filter((request) => request.user.id !== userId),
        outgoingCount: Math.max(0, current.outgoingCount - 1),
      };
    });
  }

  async function runAction(
    userId: string,
    action: "send" | "accept" | "reject" | "cancel",
  ) {
    setBusyUserId(userId);
    setSearchError("");
    setRequestsError("");
    try {
      let relationship: FriendRelationship;
      if (action === "send") {
        relationship = await sendFriendRequest(userId);
        if (relationship === "pending_sent") void loadRequests();
      } else if (action === "accept") {
        relationship = await acceptFriendRequest(userId);
        removeRequestLocally(userId, "incoming");
      } else if (action === "reject") {
        relationship = await rejectFriendRequest(userId);
        removeRequestLocally(userId, "incoming");
      } else {
        relationship = await cancelFriendRequest(userId);
        removeRequestLocally(userId, "outgoing");
      }
      updateSearchRelationship(userId, relationship);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "تعذر تحديث حالة الصداقة.";
      setSearchError(message);
      setRequestsError(message);
      void loadRequests();
    } finally {
      setBusyUserId("");
    }
  }

  return (
    <section className={embedded ? "friend-hub friend-hub-embedded" : "friend-hub"}>
      {embedded ? (
        <header className="account-friends-header">
          <div>
            <p className="eyebrow">داخل حسابك</p>
            <h2>الأصدقاء</h2>
          </div>
        </header>
      ) : (
        <>
          <Back to="/profile" />
          <p className="eyebrow">مجتمعك في Wany</p>
          <h1>الأصدقاء<span className="accent">.</span></h1>
          <p className="muted page-intro">أصدقاؤك وطلبات الصداقة والبحث في مكان واحد.</p>
        </>
      )}

      <div className="friend-tabs friend-hub-tabs" role="tablist" aria-label="قسم الأصدقاء">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "friends"}
          className={tab === "friends" ? "active" : ""}
          onClick={() => setTab("friends")}
        >
          أصدقائي <span>{friends.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "requests"}
          className={tab === "requests" ? "active" : ""}
          onClick={() => setTab("requests")}
        >
          الطلبات
          {requests.incomingCount > 0 && (
            <span className="friend-request-badge">{requests.incomingCount}</span>
          )}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "search"}
          className={tab === "search" ? "active" : ""}
          onClick={() => setTab("search")}
        >
          البحث
        </button>
      </div>

      {tab === "friends" && (
        <>
          {friendsError && (
            <div className="profile-section-error compact">
              <span>{friendsError}</span>
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  setFriendsError("");
                  void refreshFriends().catch((cause) =>
                    setFriendsError(
                      cause instanceof Error ? cause.message : "تعذر تحميل الأصدقاء.",
                    ),
                  );
                }}
              >
                إعادة المحاولة
              </button>
            </div>
          )}
          <div className="friends-list">
            {friends.map((friend, index) => (
              <Link key={friend.user.id} to={`/friends/${friend.user.id}`} className="friend-row">
                <UserAvatar user={friend.user} className={`large tone-${index % 3}`} />
                <div>
                  <h2>{friend.user.name}</h2>
                  <small>@{friend.user.username}</small>
                </div>
                <span aria-hidden="true">↗</span>
              </Link>
            ))}
          </div>
          {!friends.length && !friendsError && (
            <div className="friend-empty-state">
              <p>ما عندك أصدقاء حتى الآن.</p>
              <button className="secondary" type="button" onClick={() => setTab("search")}>
                البحث عن مستخدم
              </button>
            </div>
          )}
        </>
      )}

      {tab === "requests" && (
        <div className="friend-requests-panel">
          {requestsLoading ? (
            <p className="friend-empty">جاري تحميل الطلبات…</p>
          ) : (
            <>
              <section className="friend-request-section">
                <div className="friend-request-heading">
                  <h3>طلبات الصداقة</h3>
                  <span>{requests.incomingCount}</span>
                </div>
                {requests.incoming.map((request, index) => (
                  <div className="friend-request-card" key={request.user.id}>
                    <Link className="friend-result-identity" to={`/friends/${request.user.id}`}>
                      <UserAvatar user={request.user} className={`tone-${index % 3}`} />
                      <span>
                        <b>{request.user.name}</b>
                        <small>@{request.user.username}</small>
                      </span>
                    </Link>
                    <RelationshipActions
                      relationship="pending_received"
                      busy={busyUserId === request.user.id}
                      onAccept={() => void runAction(request.user.id, "accept")}
                      onReject={() => void runAction(request.user.id, "reject")}
                    />
                  </div>
                ))}
                {!requests.incoming.length && (
                  <p className="friend-empty">لا توجد طلبات صداقة جديدة.</p>
                )}
              </section>

              <section className="friend-request-section">
                <div className="friend-request-heading">
                  <h3>الطلبات المرسلة</h3>
                  <span>{requests.outgoingCount}</span>
                </div>
                {requests.outgoing.map((request, index) => (
                  <div className="friend-request-card" key={request.user.id}>
                    <Link className="friend-result-identity" to={`/friends/${request.user.id}`}>
                      <UserAvatar user={request.user} className={`tone-${(index + 1) % 3}`} />
                      <span>
                        <b>{request.user.name}</b>
                        <small>@{request.user.username}</small>
                      </span>
                    </Link>
                    <RelationshipActions
                      relationship="pending_sent"
                      busy={busyUserId === request.user.id}
                      onCancel={() => void runAction(request.user.id, "cancel")}
                    />
                  </div>
                ))}
                {!requests.outgoing.length && (
                  <p className="friend-empty">لا توجد طلبات مرسلة حاليًا.</p>
                )}
              </section>
            </>
          )}
          {requestsError && (
            <div className="profile-section-error compact">
              <span>{requestsError}</span>
              <button className="secondary" type="button" onClick={() => void loadRequests()}>
                إعادة المحاولة
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "search" && (
        <section className="friend-search-hub" aria-label="البحث عن مستخدم">
          <form className="friend-search" onSubmit={submitSearch}>
            <label htmlFor="friend-search-input">البحث عن مستخدم</label>
            <div className="friend-search-controls">
              <input
                id="friend-search-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                placeholder="اسم المستخدم أو اسم العرض"
              />
              <button className="secondary" disabled={searching}>
                {searching ? "جاري البحث…" : "بحث"}
              </button>
            </div>
            {searchError && <p className="error">{searchError}</p>}
          </form>

          {searchDone && (
            <div className="friend-search-results" aria-live="polite">
              {searchResults.map((result, index) => (
                <div className="friend-result-card" key={result.user.id}>
                  <Link className="friend-result-identity" to={`/friends/${result.user.id}`}>
                    <UserAvatar user={result.user} className={`tone-${index % 3}`} />
                    <span>
                      <b>{result.user.name}</b>
                      <small>@{result.user.username}</small>
                    </span>
                  </Link>
                  <RelationshipActions
                    relationship={result.relationship}
                    busy={busyUserId === result.user.id}
                    onSend={() => void runAction(result.user.id, "send")}
                    onAccept={() => void runAction(result.user.id, "accept")}
                    onReject={() => void runAction(result.user.id, "reject")}
                    onCancel={() => void runAction(result.user.id, "cancel")}
                  />
                </div>
              ))}
              {!searching && !searchResults.length && (
                <p className="friend-empty">لم نجد مستخدمًا بهذا الاسم.</p>
              )}
            </div>
          )}
        </section>
      )}
    </section>
  );
}

export function FriendProfile() {
  const { id = "" } = useParams();
  const {
    user,
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    cancelFriendRequest,
    removeFriend,
  } = useLibrary();
  const [profile, setProfile] = useState<UserProfileView | null>(null);
  const [series, setSeries] = useState<Record<string, SourceManga>>({});
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState(false);

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

  const readingEntries = useMemo(
    () => (profile?.library ?? []).filter((entry) => entry.status === "reading"),
    [profile?.library],
  );
  const readingSignature = readingEntries.map((entry) => entry.mangaId).join("|");

  useEffect(() => {
    let active = true;
    if (!readingEntries.length) {
      setSeries({});
      return;
    }
    Promise.allSettled(
      readingEntries.map((entry) => sourceService.getSeries(entry.mangaId)),
    ).then((results) => {
      if (!active) return;
      setSeries(
        Object.fromEntries(
          results.flatMap((result, index) =>
            result.status === "fulfilled"
              ? [[readingEntries[index].mangaId, result.value]]
              : [],
          ),
        ),
      );
    });
    return () => {
      active = false;
    };
  }, [readingSignature]);

  if (id === user?.id) return <Navigate to="/profile" replace />;

  if (loading) {
    return (
      <>
        <Back to="/friends" />
        <ProfileOverviewSkeleton />
      </>
    );
  }

  if (!profile) {
    return (
      <>
        <Back to="/friends" />
        <div className="profile-section-error" role="alert">
          <span>{pageError || "الحساب غير موجود."}</span>
        </div>
      </>
    );
  }

  const profileUserId = profile.user.id;
  const isPrivate = profile.access === "private";
  const relationship = profile.relationship;

  async function updateRelationship(
    action: "send" | "accept" | "reject" | "cancel" | "remove",
  ) {
    setActionBusy(true);
    setActionError("");
    try {
      let next: FriendRelationship;
      if (action === "send") next = await sendFriendRequest(profileUserId);
      else if (action === "accept") next = await acceptFriendRequest(profileUserId);
      else if (action === "reject") next = await rejectFriendRequest(profileUserId);
      else if (action === "cancel") next = await cancelFriendRequest(profileUserId);
      else {
        await removeFriend(profileUserId);
        next = "none";
      }
      setProfile((current) =>
        current ? { ...current, relationship: next } : current,
      );
      if (action === "remove") setRemoveConfirm(false);
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : "تعذر تحديث حالة الصداقة.",
      );
    } finally {
      setActionBusy(false);
    }
  }

  const relationshipActions = (
    <RelationshipActions
      relationship={relationship}
      busy={actionBusy}
      onSend={() => void updateRelationship("send")}
      onAccept={() => void updateRelationship("accept")}
      onReject={() => void updateRelationship("reject")}
      onCancel={() => void updateRelationship("cancel")}
      onRemove={() => setRemoveConfirm(true)}
    />
  );

  return (
    <>
      <Back to="/friends" />

      <ProfileIdentityHeader
        user={profile.user}
        actions={relationshipActions}
        privateState={isPrivate}
        friends={profile.stats?.friends}
        friendsTo="#profile-public-friends"
      />

      {removeConfirm && relationship === "friends" && (
        <div className="friend-remove-confirm" role="alert">
          <p>هل تريد إزالة هذا المستخدم من الأصدقاء؟</p>
          <div>
            <button
              className="secondary"
              type="button"
              disabled={actionBusy}
              onClick={() => setRemoveConfirm(false)}
            >
              إلغاء
            </button>
            <button
              className="primary"
              type="button"
              disabled={actionBusy}
              onClick={() => void updateRelationship("remove")}
            >
              {actionBusy ? "جاري الإزالة…" : "إزالة"}
            </button>
          </div>
        </div>
      )}

      {actionError && <p className="error">{actionError}</p>}

      {isPrivate ? (
        <FavoritesSection profile={profile} works={sourceItems} />
      ) : profile.stats ? (
        <>
          <ProfileStatsSection stats={profile.stats} />

          <ProfileListsSection
            favorites={profile.favorites}
            favoriteCount={profile.favoriteCount}
            lists={profile.lists ?? []}
            works={sourceItems}
            viewAllTo=""
          />

          <ProfileReadingSection
            entries={readingEntries}
            series={series}
            own={false}
          />

          <ProfileActivitySection
            events={profile.activity ?? []}
            showActor
          />

          <PublicFriendsSection friends={profile.friends ?? []} />
        </>
      ) : null}
    </>
  );
}

