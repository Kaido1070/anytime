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
  [10, "البداية", "10 فصول فعلية"],
  [25, "قارئ ثابت", "25 فصلًا فعليًا"],
  [50, "نصف المئة", "50 فصلًا فعليًا"],
  [100, "المئوية", "100 فصل فعلي"],
  [250, "رحلة طويلة", "250 فصلًا فعليًا"],
  [500, "مخضرم", "500 فصل فعلي"],
  [1000, "ألفية", "1000 فصل فعلي"],
  [2500, "التيتان", "2500 فصل فعلي"],
  [5000, "أسطورة Wany", "5000 فصل فعلي"],
] as const;

const STORY_TROPHIES = [
  [1, "القصة الأولى", "أنهيت أو تابعت أول قصة"],
  [5, "جامع القصص", "5 قصص مقروءة"],
  [10, "عشرة عوالم", "10 قصص مقروءة"],
  [25, "مستكشف", "25 قصة مقروءة"],
  [50, "موسوعة", "50 قصة مقروءة"],
  [100, "مئة قصة", "100 قصة مقروءة"],
] as const;

const STREAK_TROPHIES = [
  [3, "ثلاثية", "3 أيام قراءة متتالية"],
  [7, "أسبوع كامل", "7 أيام متتالية"],
  [14, "أسبوعان", "14 يومًا متتاليًا"],
  [30, "شهر القراءة", "30 يومًا متتاليًا"],
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
      value: stats.organicChapters,
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
  return CHAPTER_TROPHIES.find(([threshold]) => stats.organicChapters < threshold) ?? null;
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

  if (!stats && !error) {
    return <div className="reading-stats-loading">جاري تجهيز تقدمك…</div>;
  }

  if (!stats) {
    return <div className="profile-section-error">{error}</div>;
  }

  const unlocked = trophies.filter((trophy) => trophy.value >= trophy.threshold);
  const next = nextChapterGoal(stats);
  const nextPercent = next
    ? Math.min(100, Math.round((stats.organicChapters / next[0]) * 100))
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
          <span>قصص قرأتها</span>
          <small>منذ إنشاء الحساب</small>
        </article>
        <article>
          <strong>{formatNumber(stats.dailyAverage, 1)}</strong>
          <span>فصل / يوم</span>
          <small>قراءة فعلية فقط</small>
        </article>
        <article>
          <strong>{formatNumber(stats.activeDays)}</strong>
          <span>أيام نشطة</span>
          <small>أيام فتحت فيها فصولًا</small>
        </article>
        <article>
          <strong>{formatNumber(stats.currentStreak)}</strong>
          <span>السلسلة الحالية</span>
          <small>يوم متتالٍ</small>
        </article>
      </div>

      <section className="reading-stats-split" aria-label="تصنيف القراءة">
        <article className="reading-stat-panel primary">
          <div>
            <p className="eyebrow">قراءة فعلية</p>
            <h3>{formatNumber(stats.organicChapters)} فصل</h3>
          </div>
          <p>
            الفصول التي فتحتها وقرأتها واحدًا واحدًا. هذه هي التي تدخل في المعدل اليومي وتروفيات الفصول.
          </p>
        </article>
        <article className="reading-stat-panel">
          <div>
            <p className="eyebrow">بكجات مسجلة</p>
            <h3>{formatNumber(stats.bulkPacks)} بكج</h3>
          </div>
          <p>
            {formatNumber(stats.bulkStories)} أعمال · {formatNumber(stats.bulkChapters)} فصل مسجل دفعة واحدة.
            لا تدخل في معدل القراءة اليومي أو تروفيات الفصول.
          </p>
        </article>
      </section>

      <section className="reading-next-goal">
        <div className="reading-next-goal-heading">
          <div>
            <p className="eyebrow">الهدف القادم</p>
            <h3>{next ? next[1] : "أعلى رتبة حالية"}</h3>
          </div>
          <strong>{next ? `${formatNumber(stats.organicChapters)} / ${formatNumber(next[0])}` : "100%"}</strong>
        </div>
        <div className="reading-next-goal-track" aria-label="تقدم الهدف القادم">
          <span style={{ width: `${nextPercent}%` }} />
        </div>
        <small>{next ? next[2] : "وصلت إلى أعلى تروفي فصول حاليًا."}</small>
      </section>

      <section className="reading-streak-panel">
        <div>
          <span>أفضل سلسلة</span>
          <strong>{formatNumber(stats.bestStreak)} يوم</strong>
        </div>
        <div>
          <span>أفضل يوم</span>
          <strong>{formatNumber(stats.bestDay.chapters)} فصل</strong>
        </div>
        <div>
          <span>عمر الحساب</span>
          <strong>{formatNumber(stats.accountDays)} يوم</strong>
        </div>
      </section>

      <section className="reading-trophies">
        <div className="reading-stats-section-heading">
          <div>
            <p className="eyebrow">التروفيات</p>
            <h3>إنجازاتك</h3>
          </div>
          <span>{unlocked.length} / {trophies.length}</span>
        </div>
        <div className="reading-trophy-grid">
          {trophies.map((trophy) => {
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
      </section>
    </section>
  );
}
