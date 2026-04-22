/**
 * Convert dates to anonymized "Day N" labels relative to the dataset's earliest date.
 */

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Convert a date string to a Day-N number. Day 1 = minDate. */
export function dateToDayNumber(dateStr: string, minDateStr: string): number {
  const d = startOfDay(new Date(dateStr));
  const min = startOfDay(new Date(minDateStr));
  return Math.round((d.getTime() - min.getTime()) / MS_PER_DAY) + 1;
}

/** Convert a date string to "Day N" label. Day 1 = minDate. */
export function dateToDayLabel(dateStr: string, minDateStr: string): string {
  return `Day ${dateToDayNumber(dateStr, minDateStr)}`;
}

/** Convert an ISO datetime to "Day N HH:mm:ss" format. */
export function datetimeToDayLabel(isoStr: string, minDateStr: string): string {
  const d = new Date(isoStr);
  const dayLabel = dateToDayLabel(isoStr, minDateStr);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${dayLabel} ${h}:${m}:${s}`;
}

/** Convert a day number back to a Date (start of day), given the minDate. */
export function dayNumberToDate(dayNum: number, minDateStr: string): Date {
  const min = startOfDay(new Date(minDateStr));
  return new Date(min.getTime() + (dayNum - 1) * MS_PER_DAY);
}

/** Calculate total days in a date range (inclusive). */
export function totalDaysInRange(minDateStr: string, maxDateStr: string): number {
  const min = startOfDay(new Date(minDateStr));
  const max = startOfDay(new Date(maxDateStr));
  return Math.round((max.getTime() - min.getTime()) / MS_PER_DAY) + 1;
}
