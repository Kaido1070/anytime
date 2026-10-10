import type { User } from "../types";

// Badges are tied to immutable login usernames, never editable display names.
export function accountBadgeKind(username: string | null | undefined): "crown" | "verified" | null {
  if (username === "m") return "crown";
  if (username === "h" || username === "y") return "verified";
  return null;
}

export function AccountBadge({ username }: { username: string | null | undefined }) {
  const kind = accountBadgeKind(username);
  if (!kind) return null;
  const title = kind === "crown" ? "حساب المالك" : "حساب موثق";
  return (
    <span className="wany-account-badge" role="img" aria-label={title} title={title}>
      <svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true" focusable="false">
        <path
          fill="var(--accent, #dbb991)"
          d="M16 1.8c2.15 0 3.18 2.37 5.16 3.14 2.08.81 4.42-.17 5.94 1.36 1.52 1.53.55 3.86 1.36 5.94.77 1.98 3.14 3.01 3.14 5.16s-2.37 3.18-3.14 5.16c-.81 2.08.16 4.41-1.36 5.94-1.52 1.53-3.86.55-5.94 1.36-1.98.77-3.01 3.14-5.16 3.14s-3.18-2.37-5.16-3.14c-2.08-.81-4.42.17-5.94-1.36-1.52-1.53-.55-3.86-1.36-5.94C4.17 19.18 1.8 18.15 1.8 16s2.37-3.18 3.14-5.16c.81-2.08-.16-4.41 1.36-5.94 1.52-1.53 3.86-.55 5.94-1.36C14.22 2.77 13.85 1.8 16 1.8Z"
        />
        {kind === "crown" ? (
          <path fill="#201a15" d="m7.2 12.2 5.4 4.2L16 9.1l3.4 7.3 5.4-4.2-1.5 10.1H8.7L7.2 12.2Zm2 11.7h13.6v1.6H9.2z" />
        ) : (
          <path d="m9.4 16.4 4.5 4.5 8.8-9.4" fill="none" stroke="#201a15" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </span>
  );
}
