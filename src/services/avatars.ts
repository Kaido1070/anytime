import type { AvatarSeries } from "../types";

function normalizedSearch(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ar");
}

export function filterAvatarSeries(series: AvatarSeries[], query: string) {
  const needle = normalizedSearch(query);
  if (!needle) return series;

  return series.flatMap((group) => {
    const seriesMatches =
      normalizedSearch(group.name).includes(needle) ||
      normalizedSearch(group.slug).includes(needle);
    const avatars = seriesMatches
      ? group.avatars
      : group.avatars.filter((avatar) =>
          normalizedSearch(avatar.characterName).includes(needle),
        );
    return avatars.length ? [{ ...group, avatars }] : [];
  });
}
