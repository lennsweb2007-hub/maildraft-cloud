/**
 * Verschachtelte Beziehungen aus Supabase flach machen.
 *
 * Supabase liefert eine verknuepfte Tabelle je nach Beziehungstyp mal als
 * Objekt, mal als Array mit einem Element - und die generierten Typen gehen
 * grundsaetzlich vom Array aus. Ohne eine gemeinsame Stelle wuerde diese
 * Unterscheidung an jedem Endpunkt einzeln aufschlagen.
 */

/** Liefert das erste Element, egal ob Objekt oder Array ankommt. */
export function eines<T>(wert: T | T[] | null | undefined): T | null {
  if (!wert) return null;
  return Array.isArray(wert) ? (wert[0] ?? null) : wert;
}

interface MitBeziehungen {
  categories?: unknown;
  email_accounts?: unknown;
  [schluessel: string]: unknown;
}

interface Kategoriebezug {
  name: string;
  color: string;
  icon?: string;
}

interface Postfachbezug {
  email_address: string;
  provider?: string;
}

/**
 * Haengt category_name, category_color und account_email direkt an das Objekt.
 * Die Oberflaeche erwartet sie dort, nicht in einer Unterstruktur.
 */
export function flach(zeile: MitBeziehungen): Record<string, unknown> {
  const { categories, email_accounts, ...rest } = zeile;

  const kategorie = eines(categories as Kategoriebezug | Kategoriebezug[] | null);
  const postfach = eines(email_accounts as Postfachbezug | Postfachbezug[] | null);

  return {
    ...rest,
    category_name: kategorie?.name ?? null,
    category_color: kategorie?.color ?? null,
    category_icon: kategorie?.icon ?? null,
    account_email: postfach?.email_address ?? null,
    account_provider: postfach?.provider ?? null,
  };
}
