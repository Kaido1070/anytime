import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SourceCoverImage } from "./SourceCoverImage";
import { sourceDisplayTitle } from "../services/sourceTitles";
import { sourceService } from "../services/sources";
import type { ActivityEvent, SourceManga } from "../types";

function formatActivityTime(timestamp: number) {
  const delta = timestamp - Date.now();
  const abs = Math.abs(delta);
  const relative = new Intl.RelativeTimeFormat("ar", { numeric: "auto" });

  if (abs < 60 * 1000) return "الآن";
  if (abs < 60 * 60 * 1000) return relative.format(Math.round(delta / (60 * 1000)), "minute");
  if (abs < 24 * 60 * 60 * 1000) return relative.format(Math.round(delta / (60 * 60 * 1000)), "hour");
  if (abs < 7 * 24 * 60 * 60 * 1000) return relative.format(Math.round(delta / (24 * 60 * 60 * 1000)), "day");

  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
}

function chapterLabel(value: number | null) {
  if (value == null) return "";
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "");
}

function EventWork({
  mangaId,
  works,
}: {
  mangaId: string | null;
  works: Record<string, SourceManga>;
}) {
  if (!mangaId) return null;
  const item = works[mangaId];
  if (!item) return <span className="activity-work-name">العمل</span>;
  const title = sourceDisplayTitle(item);
  return (
    <Link className="activity-work-name" to={`/source/${encodeURIComponent(item.key)}`}>
      {title}
    </Link>
  );
}

function ActivitySentence({
  event,
  works,
  showActor,
}: {
  event: ActivityEvent;
  works: Record<string, SourceManga>;
  showActor: boolean;
}) {
  const actor = showActor ? (
    <Link className="activity-user-link" to={`/friends/${encodeURIComponent(event.user.id)}`}>
      {event.user.name}
    </Link>
  ) : null;
  const prefix = showActor ? actor : null;
  const ownerVerb = {
    started_work: "بدأت قراءة",
    progress_reached: "وصلت إلى الفصل",
    completed_work: "أنهيت",
    favorited_work: "أضفت",
    added_to_list: "أضفت",
    created_list: "أنشأت قائمة",
  } as const;
  const socialVerb = {
    started_work: "بدأ قراءة",
    progress_reached: "وصل إلى الفصل",
    completed_work: "أنهى",
    favorited_work: "أضاف",
    added_to_list: "أضاف",
    created_list: "أنشأ قائمة",
  } as const;
  const verb = showActor ? socialVerb[event.type] : ownerVerb[event.type];

  if (event.type === "created_list") {
    return (
      <>
        {prefix}{showActor ? " " : ""}{verb}{" "}
        {event.list ? (
          <Link className="activity-list-link" to={`/lists/${encodeURIComponent(event.list.id)}`}>
            “{event.list.name}”
          </Link>
        ) : (
          <span>جديدة</span>
        )}
      </>
    );
  }

  if (event.type === "progress_reached") {
    return (
      <>
        {prefix}{showActor ? " " : ""}{verb} {chapterLabel(event.chapterNumber)} من{" "}
        <EventWork mangaId={event.mangaId} works={works} />
      </>
    );
  }

  if (event.type === "favorited_work") {
    return (
      <>
        {prefix}{showActor ? " " : ""}{verb}{" "}
        <EventWork mangaId={event.mangaId} works={works} /> إلى المفضلة
      </>
    );
  }

  if (event.type === "added_to_list") {
    return (
      <>
        {prefix}{showActor ? " " : ""}{verb}{" "}
        <EventWork mangaId={event.mangaId} works={works} /> إلى قائمة{" "}
        {event.list ? (
          <Link className="activity-list-link" to={`/lists/${encodeURIComponent(event.list.id)}`}>
            “{event.list.name}”
          </Link>
        ) : (
          <span>شخصية</span>
        )}
      </>
    );
  }

  return (
    <>
      {prefix}{showActor ? " " : ""}{verb}{" "}
      <EventWork mangaId={event.mangaId} works={works} />
    </>
  );
}

export function ActivityFeed({
  title,
  events,
  showActor = false,
  emptyText,
}: {
  title: string;
  events: ActivityEvent[];
  showActor?: boolean;
  emptyText: string;
}) {
  const [works, setWorks] = useState<Record<string, SourceManga>>({});
  const keys = useMemo(
    () =>
      [...new Set(events.flatMap((event) => (event.mangaId ? [event.mangaId] : [])))].filter(
        (key) => sourceService.isSourceKey(key),
      ),
    [events],
  );
  const signature = keys.join("|");

  useEffect(() => {
    let active = true;
    if (!keys.length) {
      setWorks({});
      return;
    }
    sourceService
      .resolve(keys)
      .then((items) => {
        if (active) setWorks(Object.fromEntries(items.map((item) => [item.key, item])));
      })
      .catch(() => {
        if (active) setWorks({});
      });
    return () => {
      active = false;
    };
  }, [signature]);

  return (
    <section className="profile-module activity-module">
      <div className="profile-module-heading">
        <h2>{title}</h2>
        {events.length > 0 && <span className="profile-module-count">آخر {events.length}</span>}
      </div>
      {events.length ? (
        <div className="activity-feed">
          {events.map((event) => {
            const item = event.mangaId ? works[event.mangaId] : null;
            return (
              <article className="activity-card" key={event.id}>
                {showActor ? (
                  <Link
                    className="avatar activity-avatar"
                    to={`/friends/${encodeURIComponent(event.user.id)}`}
                    aria-label={`فتح حساب ${event.user.name}`}
                  >
                    {event.user.name.slice(0, 1)}
                  </Link>
                ) : (
                  <span className="activity-dot" aria-hidden="true" />
                )}
                <div className="activity-card-copy">
                  <p>
                    <ActivitySentence event={event} works={works} showActor={showActor} />
                  </p>
                  <time dateTime={new Date(event.createdAt).toISOString()}>
                    {formatActivityTime(event.createdAt)}
                  </time>
                </div>
                {item?.cover ? (
                  <Link
                    className="activity-cover"
                    to={`/source/${encodeURIComponent(item.key)}`}
                    aria-label={`فتح ${sourceDisplayTitle(item)}`}
                  >
                    <SourceCoverImage item={item} alt="" loading="lazy" />
                  </Link>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="profile-module-empty activity-empty">{emptyText}</p>
      )}
    </section>
  );
}
