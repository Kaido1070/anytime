import { Link } from "react-router-dom";
import { useLibrary } from "../hooks/useLibrary";
import { manga, findManga } from "../data/mock";
import { MangaCard, SectionTitle, Progress, Icon } from "../components/UI";

export function Home() {
  const { user, data, friends } = useLibrary();
  const last = data?.lastOpened;
  const current = findManga(last?.mangaId ?? "returner") ?? manga[0];
  const chapter = last?.chapter ?? current.chapters[0];
  const percent = data?.progress[`${current.id}:${chapter}`]?.percent ?? 0;

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
            الفصل {chapter} <span className="dot-separator">·</span>{" "}
            {current.genres[0]}
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

      <section>
        <SectionTitle title="آخر التحديثات" />
        <div className="updates">
          {manga.slice(0, 3).map((item, i) => (
            <Link key={item.id} className="update-row" to={`/manga/${item.id}`}>
              <img src={item.cover} alt="" />
              <div>
                <small>{i === 0 ? "تحديث جديد" : `منذ ${i + 1} ساعات`}</small>
                <h3>{item.title}</h3>
                <p>الفصل {item.latest}</p>
              </div>
              <span className="update-dot" />
            </Link>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle title="مفضلتك" to="/favorites" label="عرض الكل" />
        <div className="cover-grid home-grid">
          {manga
            .filter((item) => data?.favorites.includes(item.id))
            .map((item) => (
              <MangaCard key={item.id} item={item} />
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
            const readingTitle = reading ? findManga(reading.mangaId)?.title : null;
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
