// Badge authorization is issued by the server from D1, never inferred from usernames.
// The icons are crisp standalone vector-image assets, not inline SVG drawings.
export function AccountBadge({ badgeType }: { badgeType: "crown" | "verified" | null | undefined }) {
  const kind = badgeType === "crown" || badgeType === "verified" ? badgeType : null;
  if (!kind) return null;
  const title = kind === "crown" ? "حساب المالك" : "حساب موثق";
  return (
    <span className="wany-account-badge" role="img" aria-label={title} title={title}>
      <img
        src={kind === "crown" ? "/badges/crown.svg" : "/badges/verified.svg"}
        width={20}
        height={20}
        alt=""
        aria-hidden="true"
        decoding="async"
      />
    </span>
  );
}
