const gregorianDateFormatter = new Intl.DateTimeFormat("en-GB", {
  calendar: "gregory",
  numberingSystem: "latn",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function formatGregorianDate(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return gregorianDateFormatter.format(date);
}


export function formatArabicRelativeTime(
  value: string | number | Date,
  now = Date.now(),
) {
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();
  if (Number.isNaN(timestamp)) return "";
  const diff = Math.max(0, now - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "الآن";
  const minutes = Math.floor(diff / minute);
  if (minutes < 60) return `منذ ${minutes} دقيقة`;

  const hours = Math.floor(diff / hour);
  if (hours === 1) return "منذ ساعة";
  if (hours === 2) return "منذ ساعتين";
  if (hours < 24) return `منذ ${hours} ساعات`;

  const days = Math.floor(diff / day);
  if (days === 1) return "أمس";
  if (days < 14) return `منذ ${days} أيام`;

  return formatGregorianDate(date);
}
