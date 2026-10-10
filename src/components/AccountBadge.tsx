import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

// The server (D1) grants badgeType. The UI only explains the existing badge.
// Using a focusable span avoids nesting a native button inside friend/profile links.
export function AccountBadge({ badgeType }: { badgeType: "crown" | "verified" | null | undefined }) {
  const kind = badgeType === "crown" || badgeType === "verified" ? badgeType : null;
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
  }, []);

  if (!kind) return null;

  const label = kind === "crown" ? "Owner" : "Beta Tester";
  const showHint = () => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    setVisible(true);
    timeoutRef.current = setTimeout(() => {
      setVisible(false);
      timeoutRef.current = null;
    }, 2500);
  };

  const handleClick = (event: MouseEvent<HTMLSpanElement>) => {
    // A badge can live inside a clickable friend card: don't open the profile.
    event.preventDefault();
    event.stopPropagation();
    showHint();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    showHint();
  };

  return (
    <span
      className="wany-account-badge"
      role="button"
      tabIndex={0}
      aria-label={`عرض الشارة: ${label}`}
      aria-expanded={visible}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <img
        src={kind === "crown" ? "/badges/crown.svg" : "/badges/verified.svg"}
        width={20}
        height={20}
        alt=""
        aria-hidden="true"
        decoding="async"
      />
      {visible && (
        <span className="wany-account-badge-tooltip" role="tooltip" dir="ltr">
          {label}
        </span>
      )}
    </span>
  );
}
