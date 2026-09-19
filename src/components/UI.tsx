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
    settings: "M12 3.75l1.05 1.9c.48.13.94.32 1.36.56l2.08-.6 1.9 3.28-1.48 1.58c.06.5.06 1.01 0 1.52l1.48 1.58-1.9 3.28-2.08-.6c-.42.24-.88.43-1.36.56L12 18.75H8.2l-1.05-1.9a7.2 7.2 0 0 1-1.36-.56l-2.08.6-1.9-3.28 1.48-1.58a7.4 7.4 0 0 1 0-1.52L1.81 8.93l1.9-3.28 2.08.6c.42-.24.88-.43 1.36-.56l1.05-1.94H12Z M10.1 14.15a2.9 2.9 0 1 0 0-5.8 2.9 2.9 0 0 0 0 5.8Z",
    edit: "M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z",
    more: "M5 12h.01 M12 12h.01 M19 12h.01",
    book: "M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5Z M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5A2.5 2.5 0 0 1 20 21.5Z",
    star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2 7.5 14 3 9.6l6.2-.9Z",
    heart: "M20.8 5.8c-2-2-5.2-2-7.2 0L12 7.4l-1.6-1.6c-2-2-5.2-2-7.2 0s-2 5.2 0 7.2L12 21l8.8-8c2-2 2-5.2 0-7.2Z",
    flame: "M13 2s1 4-2 6c-2 1.4-3 3.1-3 5a4 4 0 0 0 8 0c0-1.7-.7-3.2-2-4.5.2 2.3-.8 3.6-2 4.5.5-4-1-6-3-8 0 0-1 3-4 5-2 1.4-3 3.5-3 6a8 8 0 0 0 16 0c0-5-3-8-5-10Z",
    sword: "M14 4l6-2-2 6-8 8-4 1 1-4Z M5 19l-2 2 M8 16l-5 5",
    crown: "m4 8 4 4 4-7 4 7 4-4-2 11H6Z",
    ghost: "M5 20V9a7 7 0 0 1 14 0v11l-3-2-2 2-2-2-2 2-2-2Z M9 10h.01 M15 10h.01",
    moon: "M20 15.5A8 8 0 1 1 8.5 4 6.5 6.5 0 0 0 20 15.5Z",
    bolt: "m13 2-8 12h6l-1 8 9-13h-6Z",
    mask: "M4 6c2-2 5-3 8-3s6 1 8 3v7c0 5-4 8-8 8s-8-3-8-8Z M8 10h.01 M16 10h.01 M9 15c2 1 4 1 6 0",
    dragon: "M5 19c2-6 5-10 10-12l-2-4 5 2 2 5-4-1c-1 4-3 7-7 9Z M9 18l-5 3",
    spark: "m12 2 1.5 5 5 1.5-5 1.5-1.5 5-1.5-5-5-1.5 5-1.5Z",
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
