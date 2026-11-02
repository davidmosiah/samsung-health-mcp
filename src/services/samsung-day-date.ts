/** Samsung StepDailyTrend.DAY_TIME encodes a calendar date, not an instant. */
export function samsungDayDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.trim();
  let date: Date;
  if (/^\d{13}$/.test(text)) {
    date = new Date(Number(text));
  } else {
    if (!/^\d{4}-\d{2}-\d{2}(?:[ T]00:00:00(?:\.0{1,3})?Z?)?$/.test(text)) return undefined;
    date = new Date(text.slice(0, 10) + "T00:00:00.000Z");
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text.slice(0, 10)) return undefined;
  }
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 2000 || date.getUTCHours() || date.getUTCMinutes() || date.getUTCSeconds() || date.getUTCMilliseconds()) return undefined;
  return date.toISOString().slice(0, 10);
}
