import { useEffect, useState } from "react";
import type { User } from "../types";

type AvatarUser = Pick<User, "name" | "avatarId">;

export function UserAvatar({
  user,
  className = "",
  loading = "lazy",
  alt,
}: {
  user: AvatarUser | null | undefined;
  className?: string;
  loading?: "eager" | "lazy";
  alt?: string;
}) {
  const [failed, setFailed] = useState(false);
  const avatarId = user?.avatarId ?? null;

  useEffect(() => {
    setFailed(false);
  }, [avatarId]);

  const classes = ["avatar", "user-avatar", className].filter(Boolean).join(" ");
  const initial = user?.name?.trim().slice(0, 1) || "؟";

  if (!avatarId || failed) {
    return (
      <span
        className={classes}
        role="img"
        aria-label={alt ?? `الصورة الشخصية لـ ${user?.name ?? "المستخدم"}`}
      >
        {initial}
      </span>
    );
  }

  return (
    <span className={classes}>
      <img
        src={`/api/avatars/${encodeURIComponent(avatarId)}/image`}
        alt={alt ?? `الصورة الشخصية لـ ${user?.name ?? "المستخدم"}`}
        loading={loading}
        decoding="async"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
