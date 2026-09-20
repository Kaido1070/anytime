import { useEffect, useMemo, useState } from "react";
import { userDataService } from "../services/userData";
import type { ReadingStats } from "../types";

type Trophy = {
  id: string;
  label: string;
  description: string;
  value: number;
  threshold: number;
  category: "chapters" | "stories" | "streak";
};

const CHAPTER_TROPHIES = [
  [10, "البداية", "أكملت 10 فصول بقراءة فعلية"],
  [25, "قارئ منتظم", "أكملت 25 فصلًا بقراءة فعلية"],
  [50, "خمسون فصلًا", "أكملت 50 فصلًا بقراءة فعلية"],
  [100, "مئة فصل", "أكملت 100 فصل بقراءة فعلية"],
  [250, "قارئ متمرس", "أكملت 250 فصلًا بقراءة فعلية"],
  [500, "قارئ مخضرم", "أكملت 500 فصل بقراءة فعلية"],
  [1000, "ألف فصل", "أكملت 1,000 فصل بقراءة فعلية"],
  [2500, "قارئ استثنائي", "أكملت 2,500 فصل بقراءة فعلية"],
  [5000, "أسطورة Wany", "أكملت 5,000 فصل بقراءة فعلية"],
] as const;

const STORY_TROPHIES = [
  [1, "العمل الأول", "بدأت قراءة أول عمل"],
  [5, "خمسة أعمال", "قرأت من 5 أعمال مختلفة"],
  [10, "عشرة أعمال", "قرأت من 10 أعمال مختلفة"],
  [25, "قارئ متنوع", "قرأت من 25 عملًا مختلفًا"],
  [50, "خمسون عملًا", "قرأت من 50 عملًا مختلفًا"],
  [100, "مئة عمل", "قرأت من 100 عمل مختلف"],
] as const;

const STREAK_TROPHIES = [
  [3, "ثلاثة أيام متتالية", "قرأت في 3 أيام متتالية"],
  [7, "أسبوع متواصل", "قرأت في 7 أيام متتالية"],
  [14, "أسبوعان متواصلان", "قرأت في 14 يومًا متتاليًا"],
  [30, "شهر متواصل", "قرأت في 30 يومًا متتاليًا"],
] as const;

function formatNumber(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function trophyRows(stats: ReadingStats): Trophy[] {
  return [
    ...CHAPTER_TROPHIES.map(([threshold, label, description]) => ({
      id: `chapters-${threshold}`,
      label,
      description,
      value: stats.organicCompletedChapters,
      threshold,
      category: "chapters" as const,
    })),
    ...STORY_TROPHIES.map(([threshold, label, description]) => ({
      id: `stories-${threshold}`,
      label,
      description,
      value: stats.storiesRead,
      threshold,
      category: "stories" as const,
    })),
    ...STREAK_TROPHIES.map(([threshold, label, description]) => ({
      id: `streak-${threshold}`,
      label,
      description,
      value: stats.bestStreak,
      threshold,
      category: "streak" as const,
    })),
  ];
}

function nextChapterGoal(stats: ReadingStats) {
  return CHAPTER_TROPHIES.find(([threshold]) => stats.organicCompletedChapters < threshold) ?? null;
}

function recentCalendar(stats: ReadingStats) {
  const values = new Map(stats.recentDays.map((entry) => [entry.day, entry.chapters]));
  const now = Date.now();
  return Array.from({ length: 30 }, (_, index) => {
    const offset = 29 - index;
    const shifted = new Date(now - offset * 86400000 + 3 * 60 * 60_000);
    const day = shifted.toISOString().slice(0, 10);
    return { day, chapters: values.get(day) ?? 0 };
  });
}

export function ReadingStatsDashboard() {
  const [stats, setStats] = useState<ReadingStats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    userDataService
      .getReadingStats()
      .then((next) => active && setStats(next))
      .catch((cause) => active && setError(cause instanceof Error ? cause.message : "تعذر تحميل إحصائيات القراءة."));
    return () => {
      active = false;
    };
  }, []);

  const trophies = useMemo(() => (stats ? trophyRows(stats) : []), [stats]);
  const calendar = useMemo(() => (stats ? recentCalendar(stats) : []), [stats]);

  if (!stats && !error) {
    return <div className="reading-stats-loading">جاري تجهيز تقدمك…</div>;
  }

  if (!stats) {
    return <div className="profile-section-error">{error}</div>;
  }

  const unlocked = trophies.filter((trophy) => trophy.value >= trophy.threshold);
  const next = nextChapterGoal(stats);
  const nextPercent = next
    ? Math.min(100, Math.round((stats.organicCompletedChapters / next[0]) * 100))
    : 100;

  return (
    <section className="reading-stats-page" aria-labelledby="reading-stats-title">
      <header className="reading-stats-hero">
        <div>
          <p className="eyebrow">رحلتك في Wany</p>
          <h2 id="reading-stats-title">تقدم القراءة</h2>
          <p className="muted">
            من أول يوم في حسابك، مع فصل القراءة الفعلية عن تسجيل الأعمال دفعة واحدة.
          </p>
        </div>
        <div className="reading-stats-hero-score">
          <strong>{formatNumber(stats.organicChapters)}</strong>
          <span>فصل فعلي</span>
        </div>
      </header>

      <div className="reading-stats-summary">
        <article>
          <strong>{formatNumber(stats.storiesRead)}</strong>
          <span>أعمال قرأتها</span>
          <small>منذ إنشاء حسابك</small>
        </article>
        <article>
          <strong>{formatNumber(stats.dailyAverage, 1)}</strong>
          <span>متوسط الفصول يوميًا</span>
          <small>بناءً على القراءة الفعلية فقط</small>
        </article>
        <article>
          <strong>{formatNumber(stats.activeDays)}</strong>
          <span>أيام القراءة</span>
          <small>أيام قرأت فيها فصلًا واحدًا على الأقل</small>
        </article>
        <article>
          <strong>{formatNumber(stats.currentStreak)}</strong>
          <span>سلسلة القراءة الحالية</span>
          <small>أيام قراءة متتالية حتى الآن</small>
        </article>
      </div>

      <section className="reading-stats-split" aria-label="تصنيف القراءة">
        <article className="reading-stat-panel primary">
          <div>
            <p className="eyebrow">الفصول المقروءة فعليًا</p>
            <h3>{formatNumber(stats.organicChapters)} فصل</h3>
          </div>
          <p>
            الفصول التي قرأتها فصلًا بعد فصل. تُحتسب ضمن متوسط القراءة اليومي وتروفيات الفصول.
          </p>
        </article>
        <article className="reading-stat-panel">
          <div>
            <p className="eyebrow">فصول مسجلة دفعة واحدة</p>
            <h3>{formatNumber(stats.bulkPacks)} عملية تسجيل</h3>
          </div>
          <p>
            {formatNumber(stats.bulkStories)} أعمال · {formatNumber(stats.bulkChapters)} فصلًا سُجلت دفعة واحدة.
            لا تُحتسب ضمن متوسط القراءة اليومي أو تروفيات الفصول.
          </p>
        </article>
      </section>

      <section className="reading-next-goal">
        <div className="reading-next-goal-heading">
          <div>
            <p className="eyebrow">الإنجاز التالي</p>
            <h3>{next ? next[1] : "أعلى رتبة حالية"}</h3>
          </div>
          <strong>{next ? `${formatNumber(stats.organicCompletedChapters)} / ${formatNumber(next[0])}` : "100%"}</strong>
        </div>
        <div className="reading-next-goal-track" aria-label="تقدم الهدف القادم">
          <span style={{ width: `${nextPercent}%` }} />
        </div>
        <small>{next ? next[2] : "وصلت إلى أعلى تروفي فصول حاليًا."}</small>
      </section>

      <section className="reading-streak-panel">
        <div>
          <span>أطول سلسلة قراءة</span>
          <strong>{formatNumber(stats.bestStreak)} يوم</strong>
        </div>
        <div>
          <span>أكثر يوم قراءة</span>
          <strong>{formatNumber(stats.bestDay.chapters)} فصل</strong>
        </div>
        <div>
          <span>مدة الحساب</span>
          <strong>{formatNumber(stats.accountDays)} يومًا</strong>
        </div>
      </section>

      <section className="reading-calendar">
        <div className="reading-stats-section-heading">
          <div>
            <p className="eyebrow">آخر 30 يومًا</p>
            <h3>نشاط القراءة</h3>
          </div>
          <span>الفصول المقروءة فعليًا فقط</span>
        </div>
        <div className="reading-calendar-grid" aria-label="نشاط القراءة خلال آخر 30 يومًا">
          {calendar.map((day) => {
            const level =
              day.chapters >= 8 ? 4 :
              day.chapters >= 4 ? 3 :
              day.chapters >= 2 ? 2 :
              day.chapters >= 1 ? 1 : 0;
            return (
              <span
                key={day.day}
                className={`reading-calendar-day level-${level}`}
                title={`${day.day}: ${day.chapters} فصل`}
                aria-label={`${day.day}: ${day.chapters} فصل`}
              />
            );
          })}
        </div>
      </section>

      <section className="reading-trophies">
        <div className="reading-stats-section-heading">
          <div>
            <p className="eyebrow">التروفيات</p>
            <h3>التروفيات والإنجازات</h3>
          </div>
          <span>{unlocked.length} / {trophies.length}</span>
        </div>
        {[
          ["chapters", "إنجازات الفصول"],
          ["stories", "إنجازات الأعمال"],
          ["streak", "إنجازات الاستمرارية"],
        ].map(([category, title]) => (
          <div className="reading-trophy-category" key={category}>
            <h4>{title}</h4>
            <div className="reading-trophy-grid">
              {trophies
                .filter((trophy) => trophy.category === category)
                .map((trophy) => {
                  const earned = trophy.value >= trophy.threshold;
                  return (
                    <article className={`reading-trophy ${earned ? "earned" : "locked"}`} key={trophy.id}>
                      <div className="reading-trophy-medal" aria-hidden="true">{earned ? "◆" : "◇"}</div>
                      <div>
                        <b>{trophy.label}</b>
                        <span>{trophy.description}</span>
                      </div>
                      <small>{earned ? "مفتوح" : `${formatNumber(trophy.value)} / ${formatNumber(trophy.threshold)}`}</small>
                    </article>
                  );
                })}
            </div>
          </div>
        ))}
      </section>
    </section>
  );
}
