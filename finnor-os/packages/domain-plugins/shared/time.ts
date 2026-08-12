/**
 * Small timezone helpers shared by operational plugins. Dates returned by the
 * database/provider stay absolute ISO instants; these helpers are only for turning a
 * dealer-local calendar day into a safe UTC range. No process/server timezone leaks
 * into planning or execution.
 */

export interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const WEEKDAY_NUMBER: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function localDateParts(at: Date, timeZone: string): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: WEEKDAY_NUMBER[get("weekday")] ?? 0,
  };
}

export function isoLocalDate(parts: Pick<LocalDateParts, "year" | "month" | "day">): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** Convert a calendar wall time in `timeZone` to its UTC instant. The two-pass
 * correction handles daylight-saving offsets without a timezone dependency. */
export function zonedDateTimeToUtc(localDate: string, hour: number, minute: number, timeZone: string): Date {
  const [year, month, day] = localDate.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`Invalid local date: ${localDate}`);
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = desiredAsUtc;
  for (let pass = 0; pass < 3; pass++) {
    const observed = localDateParts(new Date(guess), timeZone);
    const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, 0, 0);
    const delta = desiredAsUtc - observedAsUtc;
    guess += delta;
    if (delta === 0) break;
  }
  return new Date(guess);
}

export function addCalendarDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

export function localDayRange(localDate: string, timeZone: string): { start: Date; end: Date } {
  return {
    start: zonedDateTimeToUtc(localDate, 0, 0, timeZone),
    end: zonedDateTimeToUtc(addCalendarDays(localDate, 1), 0, 0, timeZone),
  };
}

export interface CallingWindow {
  localDate: string;
  earliestAt: Date;
  latestAt: Date;
}

/** Returns the next weekday calling window (09:00–17:00 dealer-local). For today,
 * an in-hours approval starts after a two-minute provider buffer; after-hours work is
 * moved to the next weekday instead of surprising customers at night. */
export function nextCallingWindow(timeZone: string, from: Date, weekdayOffset: number): CallingWindow {
  const current = localDateParts(from, timeZone);
  let localDate = isoLocalDate(current);
  let daysToAdvance = 0;
  if (weekdayOffset === 0 && (current.hour > 16 || (current.hour === 16 && current.minute > 57))) daysToAdvance = 1;
  localDate = addCalendarDays(localDate, daysToAdvance);

  let acceptedWeekdays = 0;
  while (true) {
    const noon = zonedDateTimeToUtc(localDate, 12, 0, timeZone);
    const weekday = localDateParts(noon, timeZone).weekday;
    if (weekday !== 0 && weekday !== 6) {
      if (acceptedWeekdays === weekdayOffset) break;
      acceptedWeekdays++;
    }
    localDate = addCalendarDays(localDate, 1);
  }

  const opening = zonedDateTimeToUtc(localDate, 9, 0, timeZone);
  const closing = zonedDateTimeToUtc(localDate, 17, 0, timeZone);
  const sameLocalDay = localDate === isoLocalDate(current);
  const bufferedNow = new Date(from.getTime() + 2 * 60_000);
  const earliestAt = sameLocalDay && bufferedNow > opening ? bufferedNow : opening;
  return { localDate, earliestAt, latestAt: closing };
}
