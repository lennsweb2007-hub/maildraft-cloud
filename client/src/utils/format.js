/**
 * Formatierungshilfen für Datum, Zeit und Text.
 *
 * Alles in deutscher Schreibweise. Die Zeitstempel kommen als ISO-UTC vom
 * Server und werden hier in die lokale Zeit des Rechners umgerechnet.
 */

const dateTimeFormat = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormat = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const timeFormat = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
});

const weekdayFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'long' });

/** "09.08.2026, 14:03" */
export function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : dateTimeFormat.format(date);
}

/** "09.08.2026" */
export function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : dateFormat.format(date);
}

/** "14:03" */
export function formatTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : timeFormat.format(date);
}

/**
 * Kompakte, alltagstaugliche Angabe: heute nur die Uhrzeit, gestern "Gestern",
 * innerhalb einer Woche der Wochentag, danach das Datum.
 */
export function formatSmartDate(value) {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfToday - startOfDate) / 86_400_000);

  if (dayDiff === 0) return timeFormat.format(date);
  if (dayDiff === 1) return `Gestern, ${timeFormat.format(date)}`;
  if (dayDiff > 1 && dayDiff < 7) return `${weekdayFormat.format(date)}, ${timeFormat.format(date)}`;

  return dateFormat.format(date);
}

/** "vor 12 Minuten", "gerade eben" */
export function formatRelative(value) {
  if (!value) return 'noch nie';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unbekannt';

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);

  if (seconds < 0) {
    // Zukunft - relevant für "nächster Abruf".
    const future = Math.abs(seconds);
    if (future < 60) return 'in wenigen Sekunden';
    if (future < 3600) return `in ${Math.round(future / 60)} Min.`;
    return `in ${Math.round(future / 3600)} Std.`;
  }

  if (seconds < 45) return 'gerade eben';
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `vor ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'}`;
  }
  if (seconds < 86_400) {
    const hours = Math.round(seconds / 3600);
    return `vor ${hours} ${hours === 1 ? 'Stunde' : 'Stunden'}`;
  }

  const days = Math.round(seconds / 86_400);
  if (days < 30) return `vor ${days} ${days === 1 ? 'Tag' : 'Tagen'}`;

  return dateFormat.format(date);
}

/** Sekunden in "2 Std. 15 Min." */
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '-';
  if (seconds < 60) return `${seconds} Sek.`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} Min.`;

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);

  if (hours < 24) return minutes > 0 ? `${hours} Std. ${minutes} Min.` : `${hours} Std.`;

  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'Tag' : 'Tage'}`;
}

/** Sekunden als Intervalltext für die Einstellungen. */
export function formatInterval(seconds) {
  if (!seconds) return '-';
  if (seconds < 3600) return `${Math.round(seconds / 60)} Minuten`;
  const hours = seconds / 3600;
  return hours === 1 ? '1 Stunde' : `${Number.isInteger(hours) ? hours : hours.toFixed(1)} Stunden`;
}

/** Kürzt Text und hängt ein Auslassungszeichen an. */
export function truncate(text, maxLength = 120) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length <= maxLength ? value : `${value.slice(0, maxLength).trimEnd()}...`;
}

/** Bytes als "1,4 MB". */
export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1).replace('.', ',')} ${units[exponent]}`;
}

/** Initialen für den Absender-Kreis, z.B. "Maria Weber" -> "MW". */
export function initialsOf(nameOrEmail) {
  const value = String(nameOrEmail || '?').trim();

  if (value.includes('@') && !value.includes(' ')) {
    return value.slice(0, 2).toUpperCase();
  }

  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();

  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Erzeugt aus einem Text eine stabile Farbe. Damit bekommt jeder Absender
 * durchgehend denselben Kreis - hilft beim Wiedererkennen in langen Listen.
 */
export function colorFor(text) {
  const palette = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#06b6d4', '#f59e0b'];

  let hash = 0;
  for (let i = 0; i < String(text || '').length; i += 1) {
    hash = (hash * 31 + String(text).charCodeAt(i)) % 100_000;
  }

  return palette[hash % palette.length];
}
