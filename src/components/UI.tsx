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
