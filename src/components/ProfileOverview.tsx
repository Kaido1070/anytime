import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ActivityFeed } from "./ActivityFeed";
import { SourceCoverImage } from "./SourceCoverImage";
import { UserAvatar } from "./UserAvatar";
import { getContinueChapter } from "../services/reading";
import { availableChapterProgress } from "../services/profileProgress";
import { sourceDisplayTitle } from "../services/sourceTitles";
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

export function ProfileIdentityHeader({
  user,
  actions,
  privateState = false,
}: {
  user: User | null;
  actions?: ReactNode;
  privateState?: boolean;
}) {
  return (
    <header className="profile-overview-header">
      <div className="profile-overview-identity">
        <UserAvatar user={user} className="profile-overview-avatar" loading="eager" />
        <div className="profile-overview-name">
          <h1 dir="auto">{user?.name ?? "—"}</h1>
          <p dir="ltr">@{user?.username ?? "—"}</p>
          {privateState && <span className="profile-overview-private">حساب خاص</span>}
        </div>
      </div>
      {actions && <div className="profile-overview-actions">{actions}</div>}
    </header>
  );
}

export function ProfileSummaryStrip({
  friends,
  lists,
  works,
  pendingFriendRequests = 0,
  friendsTo = "/friends",
  listsTo = "/lists",
  worksTo = "#profile-reading",
}: {
  friends: number;
  lists: number;
  works: number;
  pendingFriendRequests?: number;
  friendsTo?: string;
  listsTo?: string;
  worksTo?: string;
}) {
  const cells = [
    {
      label: "الأصدقاء",
      value: friends,
      to: friendsTo,
      badge: pendingFriendRequests,
    },
    { label: "القوائم", value: lists, to: listsTo, badge: 0 },
    { label: "الأعمال", value: works, to: worksTo, badge: 0 },
  ];

  return (
    <nav className="profile-summary-strip" aria-label="ملخص الحساب">
      {cells.map((cell) => (
        <Link className="profile-summary-cell" to={cell.to} key={cell.label}>
          <span>{cell.label}</span>
          <strong>{formatCount(cell.value)}</strong>
          {cell.badge > 0 && (
            <small className="profile-summary-badge" aria-label={`${cell.badge} طلب صداقة جديد`}>
              {cell.badge > 99 ? "99+" : cell.badge}
            </small>
          )}
        </Link>
      ))}
    </nav>
  );
}

export function ProfileStatsSection({ stats }: { stats: ProfileStats }) {
  const metrics = [
    { value: stats.chaptersRead, label: "فصل مقروء" },
    { value: stats.completed, label: "عمل مكتمل" },
    { value: stats.reading, label: "أقرأ الآن" },
    { value: stats.works, label: "إجمالي الأعمال" },
  ];

  return (
    <section className="profile-overview-section profile-stats-section" aria-labelledby="profile-stats-title">
      <div className="profile-overview-section-heading">
        <h2 id="profile-stats-title">الإحصائيات</h2>
      </div>
      <div className="profile-stats-grid">
        {metrics.map((metric) => (
          <div className="profile-stat" key={metric.label}>
            <strong>{formatCount(metric.value)}</strong>
            <span>{metric.label}</span>
          </div>
        ))}
      </div>
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
}: {
  favorites: string[];
  favoriteCount: number;
  lists: ProfileListPreview[];
  works: Record<string, SourceManga>;
  viewAllTo?: string;
}) {
  const cards = [
    {
      id: "favorites",
      name: "المفضلة",
      count: favoriteCount,
      keys: favorites,
      to: "/favorites",
      system: true,
    },
    ...lists.map((list) => ({
      id: list.id,
      name: list.name,
      count: list.itemCount,
      keys: list.previewItems,
      to: `/lists/${encodeURIComponent(list.id)}`,
      system: false,
    })),
  ];

  return (
    <section className="profile-overview-section" id="profile-lists" aria-labelledby="profile-lists-title">
      <div className="profile-overview-section-heading">
        <h2 id="profile-lists-title">القوائم</h2>
        {viewAllTo && <Link to={viewAllTo}>عرض الكل</Link>}
      </div>
      {cards.length ? (
        <div className="profile-list-preview-strip">
          {cards.map((card) => (
            <Link
              className={"profile-list-preview-card" + (card.system ? " system" : "")}
              to={card.to}
              key={card.id}
            >
              <Collage keys={card.keys} works={works} />
              <span className="profile-list-preview-copy">
                <b dir="auto">{card.name}</b>
                <small>{formatCount(card.count)} عمل</small>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="profile-overview-empty">لا توجد قوائم حتى الآن.</p>
      )}
    </section>
  );
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
  const highest = entry.highestReachedChapter;
  const progress = availableChapterProgress(item.chapters, highest);
  const resumeChapter =
    own && highest != null
      ? getContinueChapter(item.chapters, highest, highestCompleted)
      : null;

  return (
    <article className="profile-reading-card">
      <Link className="profile-reading-cover" to={`/source/${encodeURIComponent(item.key)}`}>
        <SourceCoverImage item={item} alt={`غلاف ${title}`} loading="lazy" />
      </Link>
      <div className="profile-reading-copy">
        <h3 dir="auto">{title}</h3>
        <p>
          {highest == null ? "لم يسجل تقدمًا بعد" : `وصل إلى الفصل ${highest}`}
        </p>
        {progress?.latestChapter != null && (
          <p>من أصل {progress.latestChapter} فصلًا متاحًا</p>
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
            <small>{Math.round(progress.percent)}% من الفصول المتاحة</small>
          </>
        )}
        {own && resumeChapter != null ? (
          <Link
            className="primary profile-reading-continue"
            to={`/read-source/${encodeURIComponent(item.key)}/${resumeChapter}`}
          >
            متابعة القراءة
          </Link>
        ) : (
          <Link className="secondary profile-reading-continue" to={`/source/${encodeURIComponent(item.key)}`}>
            فتح العمل
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
}: {
  entries: ProfileLibraryItem[];
  series: Record<string, SourceManga>;
  own: boolean;
  completed?: Set<string>;
  viewAllTo?: string;
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
      ) : (
        <p className="profile-overview-empty">
          {entries.length ? "تعذر تحميل بيانات الفصول لهذه الأعمال." : "لا توجد أعمال تقرؤها حاليًا."}
        </p>
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
      <span className="summary" />
      <span className="stats" />
      <span className="section" />
      <span className="section short" />
    </div>
  );
}
