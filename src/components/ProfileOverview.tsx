import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ActivityFeed } from "./ActivityFeed";
import { Icon } from "./UI";
import { SourceCoverImage } from "./SourceCoverImage";
import { UserAvatar } from "./UserAvatar";
import { getResumeChapter } from "../services/reading";
import { sourceChapterProgress } from "../services/profileProgress";
import { sourceDisplayTitle } from "../services/sourceTitles";
import { readerPath } from "../services/readerPaths";
import type {
  ActivityEvent,
  ProfileLibraryItem,
  ProfileListPreview,
  ProfileStats,
  SourceManga,
  User,
} from "../types";

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Number(value) || 0));
}

export interface ProfileAchievementSummaryItem {
  category: string;
  achievement: string;
  tierIndex: number;
  kind: "chapters" | "stories" | "streak";
}

export function ProfileIdentityHeader({
  user,
  actions,
  privateState = false,
  friends,
  friendsTo = "/friends",
  pendingFriendRequests = 0,
  achievements = [],
  editableIdentity = false,
  onSaveDisplayName,
  onEditAvatar,
}: {
  user: User | null;
  actions?: ReactNode;
  privateState?: boolean;
  friends?: number;
  friendsTo?: string;
  pendingFriendRequests?: number;
  achievements?: ProfileAchievementSummaryItem[];
  editableIdentity?: boolean;
  onSaveDisplayName?: (name: string) => Promise<void>;
  onEditAvatar?: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(user?.name ?? "");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameError, setNameError] = useState("");

  useEffect(() => {
    setNameDraft(user?.name ?? "");
  }, [user?.name]);

  async function submitHeaderName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onSaveDisplayName || nameBusy) return;
    const normalized = nameDraft.trim();
    if (!normalized || normalized.length > 50) {
      setNameError("اسم العرض مطلوب ويجب ألا يتجاوز 50 حرفًا.");
      return;
    }
    setNameBusy(true);
    setNameError("");
    try {
      await onSaveDisplayName(normalized);
      setEditingName(false);
    } catch (cause) {
      setNameError(cause instanceof Error ? cause.message : "تعذر حفظ اسم العرض.");
    } finally {
      setNameBusy(false);
    }
  }
  return (
    <header className="profile-overview-header">
      <div className="profile-overview-identity">
        <div className={editableIdentity ? "profile-overview-avatar-editable" : ""}>
          <UserAvatar user={user} className="profile-overview-avatar" loading="eager" />
          {editableIdentity && onEditAvatar && (
            <button
              className="profile-overview-inline-edit profile-overview-avatar-pencil"
              type="button"
              aria-label="تغيير الصورة الشخصية"
              onClick={onEditAvatar}
            >
              <Icon name="edit" />
            </button>
          )}
        </div>
        <div className="profile-overview-details">
          <div className="profile-overview-name">
            {editableIdentity && onSaveDisplayName ? (
              editingName ? (
                <form className="profile-header-name-editor" onSubmit={submitHeaderName}>
                  <input
                    value={nameDraft}
                    maxLength={50}
                    autoFocus
                    disabled={nameBusy}
                    onChange={(event) => setNameDraft(event.target.value)}
                    aria-label="اسم العرض"
                  />
                  <button className="profile-header-name-save" type="submit" disabled={nameBusy}>
                    {nameBusy ? "…" : "حفظ"}
                  </button>
                  <button
                    className="profile-header-name-cancel"
                    type="button"
                    disabled={nameBusy}
                    onClick={() => {
                      setNameDraft(user?.name ?? "");
                      setNameError("");
                      setEditingName(false);
                    }}
                  >
                    إلغاء
                  </button>
                </form>
              ) : (
                <div className="profile-overview-name-editable">
                  <h1 dir="auto">{user?.name ?? "—"}</h1>
                  <button
                    className="profile-overview-inline-edit"
                    type="button"
                    aria-label="تعديل اسم العرض"
                    onClick={() => {
                      setNameError("");
                      setEditingName(true);
                    }}
                  >
                    <Icon name="edit" />
                  </button>
                </div>
              )
            ) : (
              <h1 dir="auto">{user?.name ?? "—"}</h1>
            )}
            <p dir="ltr">@{user?.username ?? "—"}</p>
            {nameError && <small className="profile-header-name-error">{nameError}</small>}
            {privateState && <span className="profile-overview-private">حساب خاص</span>}
          </div>
          {friends != null && (
            <Link
              className="profile-header-friends"
              to={friendsTo}
              aria-label={`${formatCount(friends)} من الأصدقاء`}
            >
              <strong>{formatCount(friends)}</strong>
              <span>الأصدقاء</span>
              {pendingFriendRequests > 0 && (
                <small
                  className="profile-header-friends-badge"
                  aria-label={`${pendingFriendRequests} طلب صداقة جديد`}
                >
                  {pendingFriendRequests > 99 ? "99+" : pendingFriendRequests}
                </small>
              )}
            </Link>
          )}
          {actions && <div className="profile-overview-actions">{actions}</div>}
        </div>
      </div>
      {achievements.length > 0 && (
        <div className="profile-header-achievements" aria-label="أحدث إنجازاتك">
          {achievements.map((item) => (
            <div className="profile-header-achievement" key={item.category}>
              <span
                className={`profile-header-achievement-badge reading-rank-badge rank-${item.tierIndex} category-${item.kind} earned`}
                aria-hidden="true"
              >
                <img
                  className="reading-rank-image"
                  src={`/ranks/${["bronze", "silver", "gold", "platinum", "diamond", "master", "elite", "legendary", "wany-legend"][Math.min(item.tierIndex, 8)]}.svg`}
                  alt=""
                />
              </span>
              <b>{item.achievement}</b>
              <small>{item.category}</small>
            </div>
          ))}
        </div>
      )}
    </header>
  );
}

export function ProfileStatsSection({
  stats,
  viewAllTo,
  achievements = [],
  readingDays,
}: {
  stats: ProfileStats;
  viewAllTo?: string;
  achievements?: ProfileAchievementSummaryItem[];
  readingDays?: number;
}) {
  const metrics = [
    { value: stats.chaptersRead, label: "فصول مقروءة" },
    { value: readingDays ?? 0, label: "أيام قراءة" },
    { value: stats.reading, label: "أقرأ الآن" },
  ];

  return (
    <section className="profile-overview-section profile-stats-section" aria-label="إحصائيات القراءة">
      {viewAllTo && (
        <div className="profile-stats-heading">
          <span>إحصائياتك</span>
          <Link to={viewAllTo}>تتبع التقدم</Link>
        </div>
      )}
      <div className="profile-stats-grid">
        {metrics.map((metric) => (
          <div className="profile-stat" key={metric.label}>
            <strong>{formatCount(metric.value)}</strong>
            <span>{metric.label}</span>
          </div>
        ))}
      </div>
      {achievements.length > 0 && (
        <div className="profile-header-achievements profile-stats-achievements" aria-label="أحدث إنجازاتك">
          {achievements.map((item) => (
            <div className="profile-header-achievement" key={item.category}>
              <span className={`profile-header-achievement-badge reading-rank-badge rank-${item.tierIndex} category-${item.kind} earned`} aria-hidden="true">
                <img className="reading-rank-image" src={`/ranks/${["bronze", "silver", "gold", "platinum", "diamond", "master", "elite", "legendary", "wany-legend"][Math.min(item.tierIndex, 8)]}.svg`} alt="" />
              </span>
              <b>{item.achievement}</b>
              <small>{item.category}</small>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Collage({
  keys,
  works,
}: {
  keys: string[];
  works: Record<string, SourceManga>;
}) {
  const items = keys
    .slice(0, 4)
    .map((key) => works[key])
    .filter((item): item is SourceManga => Boolean(item));
  return (
    <span className={"profile-list-collage count-" + Math.max(1, items.length)} aria-hidden="true">
      {items.length ? (
        items.map((item) => (
          <span key={item.key}>
            <SourceCoverImage item={item} alt="" loading="lazy" />
          </span>
        ))
      ) : (
        <span className="profile-list-collage-empty">+</span>
      )}
    </span>
  );
}

export function ProfileListsSection({
  favorites,
  favoriteCount,
  lists,
  works,
  viewAllTo = "/lists",
  error = "",
  onRetry,
  onCustomize,
}: {
  favorites: string[];
  favoriteCount: number;
  lists: ProfileListPreview[];
  works: Record<string, SourceManga>;
  viewAllTo?: string;
  error?: string;
  onRetry?: () => void;
  onCustomize?: () => void;
}) {
  const location = useLocation();
  const returnState = { returnTo: `${location.pathname}${location.search}${location.hash}` };

  const cards = [
    {
      id: "favorites",
      name: "المفضلة",
      count: favoriteCount,
      keys: favorites,
      to: "/favorites",
      iconKey: "favorites",
      system: true,
    },
    ...lists.map((list) => ({
      id: list.id,
      name: list.name,
      count: list.itemCount,
      keys: list.previewItems,
      to: `/lists/${encodeURIComponent(list.id)}`,
      iconKey: list.iconKey || "lists",
      system: false,
    })),
  ];

  return (
    <section className="profile-overview-section" id="profile-lists" aria-labelledby="profile-lists-title">
      <div className="profile-overview-section-heading">
        <h2 id="profile-lists-title">القوائم</h2>
        <div className="profile-section-heading-actions">
          {onCustomize && (
            <button
              className="profile-section-edit"
              type="button"
              onClick={onCustomize}
              aria-label="تعديل القوائم"
              title="تعديل القوائم"
            >
              <Icon name="edit" />
            </button>
          )}
          {viewAllTo && <Link to={viewAllTo} state={returnState}>عرض الكل</Link>}
        </div>
      </div>
      {cards.length ? (
        <div className="profile-list-preview-strip">
          {cards.map((card) => (
            <Link
              className={"profile-list-preview-card" + (card.system ? " system" : "")}
              to={card.to}
              state={returnState}
              key={card.id}
            >
              <Collage keys={card.keys} works={works} />
              <span className="profile-list-preview-copy">
                <span className="profile-list-preview-title">
                  <Icon name={card.iconKey} />
                  <b dir="auto">{card.name}</b>
                </span>
                <small>{formatCount(card.count)} قصص</small>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="profile-overview-empty">لا توجد قوائم حتى الآن.</p>
      )}
      {error && (
        <div className="profile-section-error compact" role="alert">
          <span>{error}</span>
          {onRetry && (
            <button className="secondary" type="button" onClick={onRetry}>
              إعادة المحاولة
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export interface ProfileReadingIssue {
  mangaId: string;
  title: string;
  sourceLabel: string;
  chapter: number | null;
  to: string;
}

function ReadingCard({
  entry,
  item,
  own,
  highestCompleted,
}: {
  entry: ProfileLibraryItem;
  item: SourceManga;
  own: boolean;
  highestCompleted: boolean;
}) {
  const title = sourceDisplayTitle(item);
  const location = useLocation();
  const returnState = { returnTo: `${location.pathname}${location.search}${location.hash}` };
  const highest = entry.highestReachedChapter;
  const progress = sourceChapterProgress(item, highest);
  // All Continue Reading entry points must resolve the same saved chapter.
  const resumeChapter = own
    ? getResumeChapter(entry, item.chapters, highestCompleted)
    : null;
  const resumeChapterEntry = item.chapters?.find(
    (chapter) => Math.abs(Number(chapter.number) - Number(resumeChapter)) < 0.000001,
  );

  const archived = item.type === "archived";

  return (
    <article className="profile-reading-card">
      {archived ? (
        <div className="profile-reading-cover" aria-label={`غلاف محفوظ لـ ${title}`}>
          <SourceCoverImage item={item} alt={`غلاف ${title}`} loading="lazy" />
        </div>
      ) : (
        <Link className="profile-reading-cover" to={`/source/${encodeURIComponent(item.key)}`} state={returnState}>
          <SourceCoverImage item={item} alt={`غلاف ${title}`} loading="lazy" />
        </Link>
      )}
      <div className="profile-reading-copy">
        <h3 dir="auto">{title}</h3>
        <p>
          {highest == null
            ? "لم يسجل تقدمًا بعد"
            : own
              ? `وصلت إلى الفصل ${highest}`
              : `وصل إلى الفصل ${highest}`}
        </p>
        {progress?.latestChapter != null && (
          <p>أحدث فصل متاح: {progress.latestChapter}</p>
        )}
        {progress && (
          <>
            <div
              className="profile-reading-progress"
              role="progressbar"
              aria-label={`نسبة الفصول المتاحة المقروءة في ${title}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress.percent)}
            >
              <span style={{ width: `${progress.percent}%` }} />
            </div>
            <small>{progress.percent > 0 && progress.percent < 1 ? "أقل من 1" : Math.round(progress.percent)}% {progress.estimated ? "تقدم تقديري حسب رقم أحدث فصل" : "من الفصول المتاحة"}</small>
          </>
        )}
        {archived && own && highest != null ? (
          <Link
            className="secondary profile-reading-continue"
            to={`/read-source/${encodeURIComponent(item.key)}/${highest}`}
            state={returnState}
          >
            محاولة فتح الفصل {highest}
          </Link>
        ) : archived ? (
          <Link
            className="secondary profile-reading-continue"
            to={`/source/${encodeURIComponent(item.key)}`}
            state={returnState}
          >
            فتح القصة
          </Link>
        ) : own && resumeChapter != null ? (
          <Link
            className="primary profile-reading-continue"
            to={readerPath(item, resumeChapter, [], resumeChapterEntry?.url)} state={returnState}
          >
            متابعة القراءة
          </Link>
        ) : (
          <Link className="secondary profile-reading-continue" to={`/source/${encodeURIComponent(item.key)}`} state={returnState}>
            فتح القصة
          </Link>
        )}
      </div>
    </article>
  );
}

export function ProfileReadingSection({
  entries,
  series,
  own,
  completed = new Set<string>(),
  viewAllTo,
  error = "",
  issues = [],
  onRetry,
  onRemoveIssue,
}: {
  entries: ProfileLibraryItem[];
  series: Record<string, SourceManga>;
  own: boolean;
  completed?: Set<string>;
  viewAllTo?: string;
  error?: string;
  issues?: ProfileReadingIssue[];
  onRetry?: () => void;
  onRemoveIssue?: (mangaId: string) => void;
}) {
  const available = entries.filter(
    (entry) => entry.status === "reading" && Boolean(series[entry.mangaId]),
  );

  return (
    <section className="profile-overview-section" id="profile-reading" aria-labelledby="profile-reading-title">
      <div className="profile-overview-section-heading">
        <h2 id="profile-reading-title">أقرأ الآن</h2>
        {viewAllTo && <Link to={viewAllTo}>عرض الكل</Link>}
      </div>
      {available.length ? (
        <div className="profile-reading-grid">
          {available.map((entry) => {
            const item = series[entry.mangaId];
            const highest = entry.highestReachedChapter;
            return (
              <ReadingCard
                key={entry.mangaId}
                entry={entry}
                item={item}
                own={own}
                highestCompleted={
                  highest != null && completed.has(`${entry.mangaId}:${highest}`)
                }
              />
            );
          })}
        </div>
      ) : entries.length && error ? null : (
        <div className="profile-reading-empty">
          <p className="profile-overview-empty">
            {entries.length ? "تعذر تحميل بيانات الفصول لهذه القصص." : "ما بدأت قراءة أي قصة حتى الآن."}
          </p>
          {!entries.length && own && (
            <Link className="secondary profile-reading-discover" to="/discover">
              استكشف القصص
            </Link>
          )}
        </div>
      )}
      {issues.length > 0 && (
        <div className="profile-reading-issues" role="status" aria-live="polite">
          {issues.map((issue) => (
            <div className="profile-reading-issue" key={issue.mangaId}>
              <span>
                تعذر تحديث <b dir="auto">{issue.title}</b>
                {issue.chapter != null ? ` عند الفصل ${issue.chapter}` : ""}.
                <small> المصدر: {issue.sourceLabel}</small>
              </span>
              <div className="profile-reading-issue-actions">
                <Link className="secondary" to={issue.to}>
                  {issue.chapter != null ? `فتح الفصل ${issue.chapter}` : "فتح القصة"}
                </Link>
                {onRemoveIssue && (
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => onRemoveIssue(issue.mangaId)}
                  >
                    إزالة من أقرأ الآن
                  </button>
                )}
              </div>
            </div>
          ))}
          {onRetry && (
            <button className="secondary profile-reading-retry" type="button" onClick={onRetry}>
              إعادة المحاولة
            </button>
          )}
        </div>
      )}
      {error && !issues.length && (
        <div className="profile-section-error compact" role="alert">
          <span>{error}</span>
          {onRetry && (
            <button className="secondary" type="button" onClick={onRetry}>
              إعادة المحاولة
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function ProfileActivitySection({
  events,
  viewAllTo,
  showActor = false,
}: {
  events: ActivityEvent[];
  viewAllTo?: string;
  showActor?: boolean;
}) {
  return (
    <ActivityFeed
      title="آخر النشاط"
      events={events.slice(0, 3)}
      showActor={showActor}
      emptyText="لا يوجد نشاط حديث حتى الآن."
      to={viewAllTo}
    />
  );
}

export function ProfileOverviewSkeleton() {
  return (
    <div className="profile-overview-skeleton" aria-label="جاري تحميل الحساب">
      <span className="stats" />
      <span className="section" />
      <span className="section short" />
    </div>
  );
}
