import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLibrary } from "../hooks/useLibrary";
import { SectionTitle, Icon } from "../components/UI";
import { SourceCard } from "../components/SourceCard";
import { SourceCoverImage } from "../components/SourceCoverImage";
import { getContinueChapter } from "../services/reading";
import { mergeSourceItems, type SourceGroup } from "../services/sourceMerge";
import { sourceService } from "../services/sources";
import type { SourceManga } from "../types";

export function Home() {
  const { user, data, friends } = useLibrary();
  const [sourceItems, setSourceItems] = useState<Record<string, SourceManga>>({});
  const [continueSeries, setContinueSeries] = useState<Record<string, SourceManga>>({});
  const [latest, setLatest] = useState<SourceGroup[]>([]);

  const continueEntries = useMemo(
    () =>
      [...(data?.library ?? [])]
        .filter(
          (entry) =>
            entry.status === "reading" &&
            entry.lastReadAt != null &&
            entry.highestReachedChapter != null &&
            sourceService.isSourceKey(entry.mangaId),
        )
        .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))
        .slice(0, 4),
    [data?.library],
  );

  const continueKeys = continueEntries.map((entry) => entry.mangaId);

  const sourceKeys = useMemo(() => {
    const keys = new Set<string>();
    const add = (key?: string | null) => {
      if (sourceService.isSourceKey(key)) keys.add(key!);
    };
    data?.favorites.forEach(add);
    data?.library.forEach((entry) => add(entry.mangaId));
    friends.forEach((friend) => {
      add(friend.reading?.mangaId);
      friend.favorites.forEach(add);
    });
    return [...keys];
  }, [data?.favorites, data?.library, friends]);

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
    if (!continueKeys.length) {
      setContinueSeries({});
      return;
    }
    Promise.allSettled(continueKeys.map((key) => sourceService.getSeries(key))).then((results) => {
      if (!active) return;
      const entries = results.flatMap((result, index) =>
        result.status === "fulfilled" ? [[continueKeys[index], result.value] as const] : [],
      );
      setContinueSeries(Object.fromEntries(entries));
    });
    return () => {
      active = false;
    };
  }, [continueKeys.join("|")]);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      sourceService.latest("mangatime", 1),
      sourceService.latest("teamx", 1),
      sourceService.latest("3asq", 1),
      sourceService.latest("starzmanga", 1),
      sourceService.latest("xsano", 1),
      sourceService.latest("mangalik", 1),
    ]).then((results) => {
      if (!active) return;
      const mangaTime = results[0].status === "fulfilled" ? results[0].value.items : [];
      const teamX = results[1].status === "fulfilled" ? results[1].value.items : [];
      const asq = results[2].status === "fulfilled" ? results[2].value.items : [];
      const starz = results[3].status === "fulfilled" ? results[3].value.items : [];
      const xsano = results[4].status === "fulfilled" ? results[4].value.items : [];
      const mangalik = results[5].status === "fulfilled" ? results[5].value.items : [];
      const interleaved: SourceManga[] = [];
      const max = Math.max(mangaTime.length, teamX.length, asq.length, starz.length, xsano.length, mangalik.length);
      for (let i = 0; i < max; i += 1) {
        if (teamX[i]) interleaved.push(teamX[i]);
        if (asq[i]) interleaved.push(asq[i]);
        if (starz[i]) interleaved.push(starz[i]);
        if (xsano[i]) interleaved.push(xsano[i]);
        if (mangalik[i]) interleaved.push(mangalik[i]);
        if (mangaTime[i]) interleaved.push(mangaTime[i]);
      }
      setLatest(mergeSourceItems(interleaved).slice(0, 4));
    });
    return () => {
      active = false;
    };
  }, []);

  const continueCards = continueEntries.flatMap((entry) => {
    const item = continueSeries[entry.mangaId] ?? sourceItems[entry.mangaId];
    const highest = entry.highestReachedChapter;
    if (!item || highest == null) return [];
    const completed = data?.completed.includes(`${entry.mangaId}:${highest}`) ?? false;
    const resumeChapter = getContinueChapter(
      continueSeries[entry.mangaId]?.chapters,
      highest,
      completed,
    );
    return [{ entry, item, highest, resumeChapter }];
  });

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

      <SectionTitle title="أكمل القراءة" />
      {continueCards.length ? (
        <section className="continue-reading-grid" aria-label="أكمل القراءة">
          {continueCards.map(({ entry, item, highest, resumeChapter }) => (
            <article className="continue-reading-card" key={entry.mangaId}>
              <Link
                className="continue-reading-cover"
                to={`/source/${encodeURIComponent(item.key)}`}
                aria-label={`فتح ${item.title}`}
              >
                {item.cover ? (
                  <SourceCoverImage item={item} alt={`غلاف ${item.title}`} />
                ) : (
                  <div className="source-cover-placeholder">{item.title.slice(0, 1)}</div>
                )}
              </Link>
              <div className="continue-reading-copy">
                <p className="eyebrow">{sourceService.sourceLabel(item.source)}</p>
                <Link to={`/source/${encodeURIComponent(item.key)}`}>
                  <h2 dir="auto">{item.title}</h2>
                </Link>
                <p className="continue-reading-meta">
                  أبعد وصول: الفصل {highest}
                  {entry.lastReadChapter != null && entry.lastReadChapter !== highest
                    ? ` · آخر فتح: ${entry.lastReadChapter}`
                    : ""}
                </p>
                <Link
                  className="primary"
                  to={`/read-source/${encodeURIComponent(item.key)}/${resumeChapter}`}
                >
                  متابعة من الفصل {resumeChapter} <Icon name="arrow" />
                </Link>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <div className="empty">
          <p>ابدأ قراءة عمل من المصادر وراح يظهر هنا بدون ما يرجع تقدمك للخلف.</p>
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
              <b>Team-X + 3asq + StarzManga + XSano + MangaLik + MangaTime</b>
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
            const friendReading = friend.reading && sourceService.isSourceKey(friend.reading.mangaId)
              ? friend.reading
              : null;
            const readingTitle = friendReading ? sourceItems[friendReading.mangaId]?.title : null;
            const favoriteCount = friend.favorites.filter((id) => sourceService.isSourceKey(id)).length;
            return (
              <Link to={`/friends/${friend.user.id}`} key={friend.user.id}>
                <span className={`avatar tone-${i}`}>{friend.user.name[0]}</span>
                <div>
                  <p>
                    <b>{friend.user.name}</b>{" "}
                    {friendReading && readingTitle
                      ? `يقرأ ${readingTitle}`
                      : favoriteCount
                        ? "حدّث مكتبته"
                        : "ما بدأ قراءة بعد"}
                  </p>
                  <small>
                    {friendReading ? `الفصل ${friendReading.chapter}` : `${favoriteCount} في المفضلة`}
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
