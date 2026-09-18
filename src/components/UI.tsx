import { Link } from "react-router-dom";

export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    home: "m3 10 9-7 9 7v10H3Z M9 20v-7h6v7",
    search: "m21 21-4.35-4.35 M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    favorites: "M6 3h12v18l-6-4-6 4Z",
    lists: "M4 6h3 M10 6h10 M4 12h3 M10 12h10 M4 18h3 M10 18h10",
    friends:
      "M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3 M18 7a3 3 0 0 1 0 6 M22 21v-3a4 4 0 0 0-3-4 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    profile: "M20 21v-2a8 8 0 0 0-16 0 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    back: "m10 5 7 7-7 7",
    arrow: "M20 12H4 m6-6-6 6 6 6",
    check: "m5 12 4 4L19 6",
    filter: "M4 5h16l-6.5 7.2V18l-3 1.5v-7.3Z",
    sparkles: "m12 3 1.2 3.3L16.5 7.5l-3.3 1.2L12 12l-1.2-3.3-3.3-1.2 3.3-1.2Z M18 13l.8 2.2L21 16l-2.2.8L18 19l-.8-2.2L15 16l2.2-.8Z M6 13l.8 2.2L9 16l-2.2.8L6 19l-.8-2.2L3 16l2.2-.8Z",
    new: "M12 3v4 M12 17v4 M4.2 7.5l3.4 2 M16.4 14.5l3.4 2 M4.2 16.5l3.4-2 M16.4 9.5l3.4-2 M9 12a3 3 0 1 1 6 0 3 3 0 0 1-6 0",
    settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2 3.46-.08-.02a1.7 1.7 0 0 0-1.78.25l-.18.1a1.7 1.7 0 0 0-.78 1.62V22h-4v-.1a1.7 1.7 0 0 0-.8-1.47l-.18-.1a1.7 1.7 0 0 0-1.78-.25l-.08.02-2-3.46.06-.06A1.7 1.7 0 0 0 6.6 15l-.1-.18A1.7 1.7 0 0 0 5 14H4v-4h1a1.7 1.7 0 0 0 1.5-.82l.1-.18a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2-3.46.08.02a1.7 1.7 0 0 0 1.78-.25l.18-.1A1.7 1.7 0 0 0 11 1.65V1h4v.65a1.7 1.7 0 0 0 .8 1.47l.18.1a1.7 1.7 0 0 0 1.78.25l.08-.02 2 3.46-.06.06A1.7 1.7 0 0 0 19.4 9l.1.18A1.7 1.7 0 0 0 21 10h1v4h-1a1.7 1.7 0 0 0-1.5.82Z",
    edit: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z",
    more: "M5 12h.01 M12 12h.01 M19 12h.01",
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
