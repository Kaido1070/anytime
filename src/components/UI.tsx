import { Link } from "react-router-dom";
import type { Manga } from "../types";
import { useLibrary } from "../hooks/useLibrary";
export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    home: "m3 10 9-7 9 7v10H3Z M9 20v-7h6v7",
    favorites: "M6 3h12v18l-6-4-6 4Z",
    friends:
      "M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3 M18 7a3 3 0 0 1 0 6 M22 21v-3a4 4 0 0 0-3-4 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    profile: "M20 21v-2a8 8 0 0 0-16 0 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    back: "m10 5 7 7-7 7",
    arrow: "M20 12H4 m6-6-6 6 6 6",
    check: "m5 12 4 4L19 6",
  };
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.arrow} />
    </svg>
  );
}
export function Progress({ value }: { value: number }) {
  return (
    <div
      className="progress"
      role="progressbar"
      aria-label="تقدم القراءة"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
    >
      <span style={{ width: `${value}%` }} />
    </div>
  );
}
export function MangaCard({
  item,
  detail = false,
}: {
  item: Manga;
  detail?: boolean;
}) {
  const { data } = useLibrary();
  const progress = Object.values(data?.progress ?? {})
    .filter((p) => p.mangaId === item.id)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return (
    <Link className="manga-card" to={`/manga/${item.id}`}>
      <div className="cover-wrap">
        <img
          src={item.cover}
          alt={`غلاف تجريبي لـ ${item.title}`}
          width="300"
          height="420"
        />
        <span className="cover-label">
          {item.status === "Completed" ? "مكتمل" : "مستمر"}
        </span>
      </div>
      <h3>{item.title}</h3>
      <p>
        {detail
          ? progress
            ? `الفصل ${progress.chapter} · قرأت ${Math.round(progress.percent)}%`
            : "لم تبدأ بعد"
          : item.genres.join(" · ")}
      </p>
      {detail && <small>آخر فصل {item.latest}</small>}
    </Link>
  );
}
export function SectionTitle({
  title,
  to,
  label = "عرض الكل",
}: {
  title: string;
  to?: string;
  label?: string;
}) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {to && (
        <Link to={to}>
          {label} <span aria-hidden="true">↗</span>
        </Link>
      )}
    </div>
  );
}
export function Back({ to = "/" }: { to?: string }) {
  return (
    <Link className="back" to={to}>
      <Icon name="back" /> رجوع
    </Link>
  );
}
