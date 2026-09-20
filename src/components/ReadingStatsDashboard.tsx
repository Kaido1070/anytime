import { useEffect, useMemo, useState } from "react";
import { userDataService } from "../services/userData";
import type { ReadingStats } from "../types";
import { Icon } from "./UI";

type TrophyCategory = "chapters" | "stories" | "streak";

type Trophy = {
  id: string;
  label: string;
  description: string;
  value: number;
  threshold: number;
  category: TrophyCategory;
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

const CATEGORY_META: Record<TrophyCategory, { title: string; icon: string; unit: string }> = {
  chapters: { title: "إنجازات الفصول", icon: "book", unit: "فصل" },
  stories: { title: "إنجازات الأعمال", icon: "lists", unit: "عمل" },
  streak: { title: "إنجازات الاستمرارية", icon: "flame", unit: "يوم" },
};

const RANK_NAMES = [
  "برونزي",
  "فضي",
  "ذهبي",
  "بلاتيني",
  "ماسي",
  "ماستر",
  "نخبة",
  "أسطوري",
  "أسطورة Wany",
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

function categoryProgress(items: Trophy[]) {
  const currentValue = items[0]?.value ?? 0;
  const next = items.find((item) => currentValue < item.threshold) ?? null;
  const currentIndex = next ? Math.max(0, items.indexOf(next) - 1) : Math.max(0, items.length - 1);
  const current = items[currentIndex] ?? null;
  const previousThreshold = next
    ? items
        .filter((item) => item.threshold < next.threshold && currentValue >= item.threshold)
        .at(-1)?.threshold ?? 0
    : items.at(-1)?.threshold ?? 0;
  const percent = next
    ? Math.max(
        0,
        Math.min(
          100,
          ((currentValue - previousThreshold) / Math.max(1, next.threshold - previousThreshold)) * 100,
        ),
      )
    : 100;

  return {
    currentValue,
    current,
    next,
    percent,
    remaining: next ? Math.max(0, next.threshold - currentValue) : 0,
  };
}

function RankBadge({
  index,
  category,
  earned,
  next,
}: {
  index: number;
  category: TrophyCategory;
  earned: boolean;
  next: boolean;
}) {
  return (
    <span
      className={[
        "reading-rank-badge",
        `rank-${Math.min(index, 8)}`,
        `category-${category}`,
        earned ? "earned" : "locked",
        next ? "next" : "",
      ].join(" ")}
      aria-hidden="true"
    >
      <img
        className="reading-rank-image"
        src={`/ranks/${["bronze", "silver", "gold", "platinum", "diamond", "master", "elite", "legendary", "wany-legend"][Math.min(index, 8)]}.svg`}
        alt=""
      />
    </span>
  );
}

export function ReadingStatsDashboard() {
  const [stats, setStats] = useState<ReadingStats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    userDataService
      .getReadingStats()
      .then((next) => active && setStats(next))
      .catch((cause) =>
        active &&
        setError(
          cause instanceof Error ? cause.message : "تعذر تحميل إحصائيات القراءة.",
        ),
      );
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

  const chapterItems = trophies.filter((item) => item.category === "chapters");
  const chapterProgress = categoryProgress(chapterItems);
  const currentRankLabel = chapterProgress.current?.label ?? "بداية الرحلة";
  const unlocked = trophies.filter((trophy) => trophy.value >= trophy.threshold).length;

  const quickStats = [
    { value: stats.storiesRead, label: "أعمال قرأتها", icon: "book" },
    { value: formatNumber(stats.dailyAverage, 1), label: "متوسط الفصول يوميًا", icon: "spark" },
    { value: stats.activeDays, label: "أيام القراءة", icon: "new" },
    { value: stats.bestStreak, label: "أطول سلسلة قراءة", icon: "flame" },
  ];

  return (
    <section className="reading-stats-page reading-stats-page-v2" aria-labelledby="reading-stats-title">
      <section className="reading-journey-hero">
        <div className="reading-journey-copy">
          <p className="eyebrow">رحلة القراءة</p>
          <div className="reading-journey-rank">
            <span className="reading-journey-rank-mark" aria-hidden="true">
              <Icon name="crown" />
            </span>
            <div>
              <span>رتبتك الحالية</span>
              <h2 id="reading-stats-title">{currentRankLabel}</h2>
            </div>
          </div>
          <p className="reading-journey-subtitle">
            كل فصل تقرؤه يقرّبك من الرتبة التالية.
          </p>
        </div>

        <div className="reading-journey-numbers">
          <div>
            <strong>{formatNumber(stats.organicCompletedChapters)}</strong>
            <span>فصل مكتمل</span>
          </div>
          <div>
            <strong>{chapterProgress.next ? formatNumber(chapterProgress.next.threshold) : "✓"}</strong>
            <span>الهدف التالي</span>
          </div>
          <div>
            <strong>{chapterProgress.next ? formatNumber(chapterProgress.remaining) : "0"}</strong>
            <span>فصل متبقٍ</span>
          </div>
        </div>

        <div className="reading-journey-progress">
          <div className="reading-journey-progress-meta">
            <span>{Math.round(chapterProgress.percent)}%</span>
            <b>
              {chapterProgress.next
                ? `${formatNumber(chapterProgress.currentValue)} / ${formatNumber(chapterProgress.next.threshold)}`
                : "اكتملت الرتب الحالية"}
            </b>
          </div>
          <div className="reading-journey-progress-track">
            <span style={{ width: `${chapterProgress.percent}%` }} />
          </div>
        </div>
      </section>

      <div className="reading-stats-quick-grid" aria-label="ملخص إحصائيات القراءة">
        {quickStats.map((item) => (
          <article key={item.label}>
            <span className="reading-stats-quick-icon" aria-hidden="true">
              <Icon name={item.icon} />
            </span>
            <div>
              <strong>{typeof item.value === "number" ? formatNumber(item.value) : item.value}</strong>
              <span>{item.label}</span>
            </div>
          </article>
        ))}
      </div>

      <section className="reading-calendar reading-calendar-compact">
        <div className="reading-stats-section-heading">
          <div>
            <p className="eyebrow">آخر 30 يومًا</p>
            <h3>نشاط القراءة</h3>
          </div>
          <span>{formatNumber(stats.activeDays)} أيام قراءة</span>
        </div>
        <div className="reading-calendar-grid" aria-label="نشاط القراءة خلال آخر 30 يومًا">
          {calendar.map((day) => {
            const level =
              day.chapters >= 8
                ? 4
                : day.chapters >= 4
                  ? 3
                  : day.chapters >= 2
                    ? 2
                    : day.chapters >= 1
                      ? 1
                      : 0;
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

      <section className="reading-achievements-compact" aria-labelledby="reading-achievements-title">
        <div className="reading-achievements-heading">
          <div>
            <p className="eyebrow">التروفيات</p>
            <h3 id="reading-achievements-title">الإنجازات</h3>
          </div>
          <span>{unlocked} / {trophies.length}</span>
        </div>

        {(["chapters", "stories", "streak"] as TrophyCategory[]).map((category) => {
          const items = trophies.filter((trophy) => trophy.category === category);
          const progress = categoryProgress(items);
          const meta = CATEGORY_META[category];

          return (
            <article className={`reading-achievement-row achievement-${category}`} key={category}>
              <div className="reading-achievement-topline">
                <div className="reading-achievement-title">
                  <span className="reading-achievement-category-icon" aria-hidden="true">
                    <Icon name={meta.icon} />
                  </span>
                  <div>
                    <h4>{meta.title}</h4>
                    <small>
                      {progress.next
                        ? `باقي ${formatNumber(progress.remaining)} ${meta.unit} إلى ${progress.next.label}`
                        : "اكتملت جميع الرتب الحالية"}
                    </small>
                  </div>
                </div>
                <strong className="reading-achievement-value">
                  {progress.next
                    ? `${formatNumber(progress.currentValue)} / ${formatNumber(progress.next.threshold)}`
                    : formatNumber(progress.currentValue)}
                </strong>
              </div>

              <div className="reading-rank-strip" role="list" aria-label={meta.title}>
                {items.map((trophy, index) => {
                  const earned = trophy.value >= trophy.threshold;
                  const isNext = progress.next?.id === trophy.id;
                  return (
                    <div className="reading-rank-item" key={trophy.id} role="listitem">
                      <RankBadge
                        index={index}
                        category={category}
                        earned={earned}
                        next={isNext}
                      />
                      <b>{RANK_NAMES[Math.min(index, RANK_NAMES.length - 1)]}</b>
                      <span>{formatNumber(trophy.threshold)}</span>
                    </div>
                  );
                })}
              </div>

              <div className="reading-achievement-progress compact">
                <div>
                  <span>{Math.round(progress.percent)}%</span>
                  <b>{progress.next ? "إلى الرتبة التالية" : "مكتمل"}</b>
                </div>
                <div className="reading-achievement-progress-track">
                  <span style={{ width: `${progress.percent}%` }} />
                </div>
              </div>
            </article>
          );
        })}
      </section>

      <details className="reading-stats-details">
        <summary>تفاصيل إضافية</summary>
        <div className="reading-stats-details-grid">
          <div>
            <span>فصول مسجلة دفعة واحدة</span>
            <strong>{formatNumber(stats.bulkChapters)}</strong>
          </div>
          <div>
            <span>عمليات التسجيل الدفعي</span>
            <strong>{formatNumber(stats.bulkPacks)}</strong>
          </div>
          <div>
            <span>أكثر يوم قراءة</span>
            <strong>{formatNumber(stats.bestDay.chapters)} فصل</strong>
          </div>
          <div>
            <span>مدة الحساب</span>
            <strong>{formatNumber(stats.accountDays)} يومًا</strong>
          </div>
        </div>
      </details>
    </section>
  );
}
