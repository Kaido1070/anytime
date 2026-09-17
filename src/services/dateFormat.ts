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
