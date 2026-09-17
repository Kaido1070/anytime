import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLibrary } from "../hooks/useLibrary";
import { SectionTitle, Progress, Icon } from "../components/UI";
import { SourceCard } from "../components/SourceCard";
import { mergeSourceItems, type SourceGroup } from "../services/sourceMerge";
import { sourceService } from "../services/sources";
import type { SourceManga } from "../types";

export function Home() {
  const { user, data, friends } = useLibrary();
  const [sourceItems, setSourceItems] = useState<Record<string, SourceManga>>({});
  const [latest, setLatest] = useState<SourceGroup[]>([]);

  const sourceKeys = useMemo(() => {
    const keys = new Set<string>();
    const add = (key?: string | null) => {
      if (sourceService.isSourceKey(key)) keys.add(key!);
    };
    add(data?.lastOpened?.mangaId);
    data?.favorites.forEach(add);
    friends.forEach((friend) => {
      add(friend.reading?.mangaId);
      friend.favorites.forEach(add);
    });
    return [...keys];
  }, [data?.lastOpened?.mangaId, data?.favorites, friends]);

  useEffect(() => {
    let active = true;
    if (!sourceKeys.length) {
      setSourceItems({});
      return;
    }
    sourceService
      .resolve(sourceKeys)
      .then((items) => {
        if (active) setSourceItems(Object.fromEntries(items.map((item) => [item.key, item])));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [sourceKeys.join("|")]);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      sourceService.latest("mangatime", 1),
      sourceService.latest("teamx", 1),
      sourceService.latest("3asq", 1),
    ]).then((results) => {
      if (!active) return;
      const mangaTime = results[0].status === "fulfilled" ? results[0].value.items : [];
      const teamX = results[1].status === "fulfilled" ? results[1].value.items : [];
      const asq = results[2].status === "fulfilled" ? results[2].value.items : [];
      const interleaved: SourceManga[] = [];
      const max = Math.max(mangaTime.length, teamX.length, asq.length);
      for (let i = 0; i < max; i += 1) {
        if (teamX[i]) interleaved.push(teamX[i]);
        if (asq[i]) interleaved.push(asq[i]);
        if (mangaTime[i]) interleaved.push(mangaTime[i]);
      }
      setLatest(mergeSourceItems(interleaved).slice(0, 4));
    });
    return () => {
      active = false;
    };
  }, []);

  const last = data?.lastOpened;
  const current = last && sourceService.isSourceKey(last.mangaId) ? sourceItems[last.mangaId] : null;
  const chapter = current && last ? last.chapter : 0;
  const percent = current ? data?.progress[`${current.key}:${chapter}`]?.percent ?? 0 : 0;
  const favoriteItems = (data?.favorites ?? [])
    .filter((id) => sourceService.isSourceKey(id))
    .map((id) => sourceItems[id])
    .filter((item): item is SourceManga => Boolean(item));
  const favoriteGroups = mergeSourceItems(favoriteItems).slice(0, 4);

  return (
    <>
      <div className="greeting">
        <p className="eyebrow">خذ لك وقت بسيط</p>
        <h1>
          أهلا برجعتك، {user?.name}
          <span className="accent">.</span>
        </h1>
        <p className="muted">فصلك الجاي ينتظرك.</p>
      </div>

      <SectionTitle title="كمل القراءة" />
      {current ? (
        <section className="continue-card">
          <Link className="continue-cover" to={`/source/${encodeURIComponent(current.key)}`}>
            {current.cover ? (
              <img
                src={sourceService.imageUrl(current.source, current.cover)}
                alt={`غلاف ${current.title}`}
              />
            ) : (
              <div className="source-cover-placeholder">{current.title.slice(0, 1)}</div>
            )}
          </Link>
          <div className="continue-copy">
            <p className="eyebrow">{sourceService.sourceLabel(current.source)}</p>
            <Link to={`/source/${encodeURIComponent(current.key)}`}>
              <h2 dir="auto">{current.title}</h2>
            </Link>
            <p className="muted">الفصل {chapter}</p>
            <div className="progress-meta">
              <span>تقدمك</span>
              <b>{Math.round(percent)}%</b>
            </div>
            <Progress value={percent} />
            <Link className="primary" to={`/read-source/${encodeURIComponent(current.key)}/${chapter}`}>
              متابعة القراءة <Icon name="arrow" />
            </Link>
          </div>
        </section>
      ) : (
        <div className="empty">
          <p>ابدأ قراءة عمل من المصادر وراح يظهر تقدمك هنا.</p>
          <Link className="primary" to="/discover">استكشف الأعمال ←</Link>
        </div>
      )}

      <section>
        <SectionTitle title="آخر التحديثات" to="/discover" label="استكشف" />
        {latest.length ? (
          <div className="cover-grid home-grid source-grid">
            {latest.map((group) => (
              <SourceCard key={group.id} item={group.primary} sources={group.items} />
            ))}
          </div>
        ) : (
          <div className="source-callout">
            <div>
              <b>Team-X + 3asq + MangaTime</b>
              <p className="muted">بحث وفصول حقيقية داخل قارئ Anytime.</p>
            </div>
            <Link className="primary" to="/discover">فتح الاستكشاف</Link>
          </div>
        )}
      </section>

      <section>
        <SectionTitle title="مفضلتك" to="/favorites" label="عرض الكل" />
        <div className="cover-grid home-grid">
          {favoriteGroups.map((group) => (
            <SourceCard key={group.id} item={group.primary} sources={group.items} />
          ))}
        </div>
        {!favoriteGroups.length && (
          <p className="empty">أضف الأعمال اللي تحبها من المصادر عشان تظهر هنا.</p>
        )}
      </section>

      <section>
        <SectionTitle title="نشاط الأصدقاء" to="/friends" label="الأصدقاء" />
        <div className="activity">
          {friends.map((friend, i) => {
            const reading = friend.reading && sourceService.isSourceKey(friend.reading.mangaId)
              ? friend.reading
              : null;
            const readingTitle = reading ? sourceItems[reading.mangaId]?.title : null;
            const favoriteCount = friend.favorites.filter((id) => sourceService.isSourceKey(id)).length;
            return (
              <Link to={`/friends/${friend.user.id}`} key={friend.user.id}>
                <span className={`avatar tone-${i}`}>{friend.user.name[0]}</span>
                <div>
                  <p>
                    <b>{friend.user.name}</b>{" "}
                    {reading && readingTitle
                      ? `يقرأ ${readingTitle}`
                      : favoriteCount
                        ? "حدّث مكتبته"
                        : "ما بدأ قراءة بعد"}
                  </p>
                  <small>
                    {reading ? `الفصل ${reading.chapter}` : `${favoriteCount} في المفضلة`}
                  </small>
                </div>
                <span aria-hidden="true">↗</span>
              </Link>
            );
          })}
        </div>
      </section>

      <footer className="page-footer">مكان هادي وقصة حلوة في أي وقت.</footer>
    </>
  );
}
