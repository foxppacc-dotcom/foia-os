// Shared Arabic date/time formatting -- always Gregorian.
//
// Every call site in this app used to call toLocaleDateString('ar-SA', ...)
// directly. 'ar-SA' (Saudi Arabia) is documented to default to the Islamic
// Umm al-Qura calendar on many mobile OS/browser combinations depending on
// the device's own region settings, while desktop Chrome frequently doesn't
// apply that same override -- so the exact same message showed a Hijri date
// on someone's phone and a Gregorian date on their computer. `calendar:
// 'gregory'` forces the Gregorian calendar regardless of device/locale
// quirks, on every platform.
const LOCALE = 'ar-SA';

// A truthy-but-unparseable input (malformed/legacy data) doesn't throw here --
// `new Date('garbage').toLocaleDateString(...)` just returns the literal
// string "Invalid Date" -- so without this check that literal string could
// leak straight into the UI, or even into a composed email reply's quoted
// attribution line via formatArabicDateTime.
function toValidDate(date) {
  const d = new Date(date);
  return isNaN(d.getTime()) ? null : d;
}

export function formatArabicDate(date) {
  if (!date) return '';
  const d = toValidDate(date);
  return d ? d.toLocaleDateString(LOCALE, { calendar: 'gregory' }) : '';
}

export function formatArabicTime(date, opts = { hour: '2-digit', minute: '2-digit' }) {
  if (!date) return '';
  const d = toValidDate(date);
  return d ? d.toLocaleTimeString(LOCALE, { ...opts, calendar: 'gregory' }) : '';
}

export function formatArabicDateTime(date) {
  if (!date) return '';
  const d = toValidDate(date);
  if (!d) return '';
  return `${formatArabicDate(d)} ${formatArabicTime(d)}`;
}

// For call sites that already pass extra Intl options (e.g. { weekday:
// 'long', month: 'long', day: 'numeric' }) alongside the locale -- merges in
// calendar: 'gregory' without needing every caller to repeat it.
export function formatArabicDateWithOptions(date, options) {
  if (!date) return '';
  const d = toValidDate(date);
  return d ? d.toLocaleDateString(LOCALE, { ...options, calendar: 'gregory' }) : '';
}

// True when two timestamps fall on the same CALENDAR day (not "within 24h" --
// 11pm and 1am the next morning are 2 hours apart but different days).
// Shared by every chat-style message list (AI assistant widget/full-page,
// internal team messaging) to decide where to insert a date divider between
// consecutive messages.
export function isSameDay(a, b) {
  const da = toValidDate(a), db = toValidDate(b);
  if (!da || !db) return false;
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

// "اليوم"/"أمس" for the two cases a human actually reads at a glance;
// anything older falls back to the real Gregorian date rather than an
// ever-growing "N days ago" that stops being useful after a week.
export function dayDividerLabel(date) {
  const d = toValidDate(date);
  if (!d) return '';
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return 'اليوم';
  if (diffDays === 1) return 'أمس';
  return formatArabicDate(d);
}
