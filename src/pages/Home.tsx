import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLibrary } from "../hooks/useLibrary";
import { manga, findManga } from "../data/mock";
import { MangaCard, SectionTitle, Progress, Icon } from "../components/UI";
import { SourceCard } from "../components/SourceCard";
import { sourceService } from "../services/sources";
import type { SourceManga } from "../types";

export function Home() {
  const { user, data, friends } = useLibrary();
  const [sourceItems, setSourceItems] = useState<Record<string, SourceManga>>({});
  const [latest, setLatest] = useState<SourceManga[]>([]);

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
    if (!sourceKeys.length) {
      setSourceItems({});
      return;
    }
    let active = true;
    sourceService
      .resolve(sourceKeys)
      .then((items) => {
        if (!active) return;
        setSourceItems(Object.fromEntries(items.map((item) => [item.key, item])));
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
    ]).then((results) => {
      if (!active) return;
      const mangaTime = results[0].status === "fulfilled" ? results[0].value.items : [];
      const teamX = results[1].status === "fulfilled" ? results[1].value.items : [];
      const merged: SourceManga[] = [];
      const max = Math.max(mangaTime.length, teamX.length);
      for (let i = 0; i < max && merged.length < 4; i += 1) {
        if (mangaTime[i]) merged.push(mangaTime[i]);
        if (teamX[i] && merged.length < 4) merged.push(teamX[i]);
      }
      setLatest(merged);
    });
    return () => {
      active = false;
    };
  }, []);

  const last = data?.lastOpened;
  const sourceCurrent = last && sourceService.isSourceKey(last.mangaId)
    ? sourceItems[last.mangaId]
    : null;
  const staticCurrent = last && !sourceService.isSourceKey(last.mangaId)
    ? findManga(last.mangaId)
    : null;
  const current = staticCurrent ?? (!last ? manga[0] : null);
  const chapter = last?.chapter ?? current?.chapters[0] ?? 0;
  const progressId = sourceCurrent?.key ?? current?.id;
  const percent = progressId ? data?.progress[`${progressId}:${chapter}`]?.percent ?? 0 : 0;

  const staticFavorites = manga.filter((item) => data?.favorites.includes(item.id));
  const sourceFavorites = (data?.favorites ?? [])
    .filter((id) => sourceService.isSourceKey(id))
    .map((id) => sourceItems[id])
    .filter(Boolean)
    .slice(0, 4);

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
      {sourceCurrent ? (
        <section className="continue-card">
          <Link className="continue-cover" to={`/source/${encodeURIComponent(sourceCurrent.key)}`}>
            {sourceCurrent.cover ? (
              <img
                src={sourceService.imageUrl(sourceCurrent.source, sourceCurrent.cover)}
                alt={`غلاف ${sourceCurrent.title}`}
              />
            ) : (
              <div className="source-cover-placeholder">{sourceCurrent.title.slice(0, 1)}</div>
            )}
          </Link>
          <div className="continue-copy">
            <p className="eyebrow">{sourceService.sourceLabel(sourceCurrent.source)}</p>
            <Link to={`/source/${encodeURIComponent(sourceCurrent.key)}`}>
              <h2 dir="auto">{sourceCurrent.title}</h2>
            </Link>
            <p className="muted">الفصل {chapter}</p>
            <div className="progress-meta">
              <span>تقدمك</span>
              <b>{Math.round(percent)}%</b>
            </div>
            <Progress value={percent} />
            <Link className="primary" to={`/read-source/${encodeURIComponent(sourceCurrent.key)}/${chapter}`}>
              متابعة القراءة <Icon name="arrow" />
            </Link>
          </div>
        </section>
      ) : current ? (
        <section className="continue-card">
          <Link className="continue-cover" to={`/manga/${current.id}`}>
            <img src={current.cover} alt={`غلاف ${current.title}`} />
          </Link>
          <div className="continue-copy">
            <p className="eyebrow">من نفس المكان اللي وقفت عنده</p>
            <Link to={`/manga/${current.id}`}>
              <h2>{current.title}</h2>
            </Link>
            <p className="muted">
              الفصل {chapter} <span className="dot-separator">·</span> {current.genres[0]}
            </p>
            <div className="progress-meta">
              <span>تقدمك</span>
              <b>{Math.round(percent)}%</b>
            </div>
            <Progress value={percent} />
            <Link className="primary" to={`/read/${current.id}/${chapter}`}>
              متابعة القراءة <Icon name="arrow" />
            </Link>
          </div>
        </section>
      ) : (
        <div className="empty">
          <p>ابدأ عملا من المصادر وراح يظهر تقدمك هنا.</p>
          <Link className="primary" to="/discover">استكشف الأعمال ←</Link>
        </div>
      )}

      <section>
        <SectionTitle title="من المصادر" to="/discover" label="استكشف" />
        {latest.length ? (
          <div className="cover-grid home-grid source-grid">
            {latest.map((item) => (
              <SourceCard key={item.key} item={item} />
            ))}
          </div>
        ) : (
          <div className="source-callout">
            <div>
              <b>MangaTime + Team-X</b>
              <p className="muted">بحث وفصول حقيقية داخل قارئ Anytime.</p>
            </div>
            <Link className="primary" to="/discover">فتح الاستكشاف</Link>
          </div>
        )}
      </section>

      <section>
        <SectionTitle title="مفضلتك" to="/favorites" label="عرض الكل" />
        <div className="cover-grid home-grid">
          {staticFavorites.slice(0, Math.max(0, 4 - sourceFavorites.length)).map((item) => (
            <MangaCard key={item.id} item={item} />
          ))}
          {sourceFavorites.map((item) => (
            <SourceCard key={item.key} item={item} />
          ))}
        </div>
        {!data?.favorites.length && (
          <p className="empty">أضف الأعمال اللي تحبها من صفحة العمل عشان تظهر هنا.</p>
        )}
      </section>

      <section>
        <SectionTitle title="نشاط الأصدقاء" to="/friends" label="الأصدقاء" />
        <div className="activity">
          {friends.map((friend, i) => {
            const reading = friend.reading;
            const staticReading = reading ? findManga(reading.mangaId) : null;
            const sourceReading = reading ? sourceItems[reading.mangaId] : null;
            const readingTitle = staticReading?.title ?? sourceReading?.title ?? null;
            return (
              <Link to={`/friends/${friend.user.id}`} key={friend.user.id}>
                <span className={`avatar tone-${i}`}>{friend.user.name[0]}</span>
                <div>
                  <p>
                    <b>{friend.user.name}</b>{" "}
                    {reading && readingTitle
                      ? `يقرأ ${readingTitle}`
                      : friend.favorites.length
                        ? "حدّث مكتبته"
                        : "ما بدأ قراءة بعد"}
                  </p>
                  <small>
                    {reading ? `الفصل ${reading.chapter}` : `${friend.favorites.length} في المفضلة`}
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
