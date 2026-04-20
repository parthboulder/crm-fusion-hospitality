/**
 * Resolve a raw property string (as extracted by the OCR parsers) to the
 * canonical name used by the Stoneriver dashboard.
 *
 * The UI keys every row by property_name and compares against a hard-coded
 * list of 21 canonical names in apps/web/src/constants/stoneriver-properties.ts.
 * If an ingested row's name doesn't exactly match one of those 21 strings,
 * the row disappears from the dashboard. If two variants ingest under
 * different text strings, the Map coalesces one and the other is lost.
 *
 * This resolver is the single authority for "what do we call this hotel when
 * we store it in flash_report / daily_hotel_performance?" Every ingest path
 * must run through it. If a raw name can't be resolved, the caller flags the
 * row `needs_review = true` and records the original string so ops can either
 * extend the alias table or fix the source PDF.
 *
 * The 21 canonical names here MUST stay in sync with
 *   apps/web/src/constants/stoneriver-properties.ts
 * If a property is added/renamed on either side, update both.
 */

// Canonical names — must match PROPERTIES[i].name in the UI constants file.
const CANONICAL_NAMES = [
  'Candlewood Suites',
  'Holiday Inn Express Fulton',
  'Holiday Inn Express Memphis Southwind',
  'Holiday Inn Express Tupelo',
  'Holiday Inn Tupelo',
  'Holiday Inn Meridian',
  'Four Points Memphis Southwind',
  'TownePlace Suites',
  'Best Western Tupelo',
  'SureStay Hotel',
  'Best Western Plus Olive Branch',
  'Hyatt Place Biloxi',
  'Comfort Inn Tupelo',
  'HGI Olive Branch',
  'Home2 Suites By Hilton',
  'Tru By Hilton Tupelo',
  'Hilton Garden Inn Meridian',
  'Hampton Inn Meridian',
  'Hampton Inn Vicksburg',
  'DoubleTree Biloxi',
  'Hilton Garden Inn Madison',
] as const;

export type CanonicalProperty = (typeof CANONICAL_NAMES)[number];

const CANONICAL_SET: ReadonlySet<string> = new Set(CANONICAL_NAMES);

/**
 * Collapse a raw string into a form stable enough to match variants:
 *   - lowercase
 *   - unify dash family ( -, –, —, / )
 *   - strip punctuation that doesn't carry meaning (",", ".", "'")
 *   - strip state/city suffixes like "MS", "Mississippi"
 *   - drop "LLC", "Inc", "Hotel"
 *   - collapse whitespace
 *
 * Returns a lowercase token string suitable for use as a lookup key.
 */
export function normalizeForMatch(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2043/]/g, '-')             // various dashes + slash → hyphen
    .replace(/[.,']/g, ' ')                              // punctuation → space
    .replace(/\b(ms|mississippi)\b/g, ' ')               // drop state noise
    .replace(/\b(llc|inc|hotel|hotels|the)\b/g, ' ')     // drop corp/filler words
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Alias table — maps normalized raw strings to a canonical property.
 * Grows organically as new PDF variants appear. Keep keys lowercase,
 * already-normalized.
 *
 * Rule of thumb when adding entries: run normalizeForMatch() on the
 * incoming string and use that as the key.
 */
const ALIASES: Record<string, CanonicalProperty> = {
  // Home2 Suites variants
  'home2 suites by hilton - tupelo': 'Home2 Suites By Hilton',
  'home2 suites by hilton tupelo': 'Home2 Suites By Hilton',
  'home 2 suites by hilton tupelo': 'Home2 Suites By Hilton',
  'home2 suites tupelo': 'Home2 Suites By Hilton',
  'home 2 suites': 'Home2 Suites By Hilton',
  'home2 suites by hilton': 'Home2 Suites By Hilton',

  // Tru by Hilton
  'tru by hilton tupelo': 'Tru By Hilton Tupelo',
  'tru tupelo': 'Tru By Hilton Tupelo',

  // SureStay
  'surestay tupelo': 'SureStay Hotel',
  'sure stay tupelo': 'SureStay Hotel',
  'surestay by best western': 'SureStay Hotel',

  // HGI
  'hgi olive branch': 'HGI Olive Branch',
  'hilton garden inn olive branch': 'HGI Olive Branch',
  'hgi meridian': 'Hilton Garden Inn Meridian',
  'hilton garden inn meridian': 'Hilton Garden Inn Meridian',
  'hgi madison': 'Hilton Garden Inn Madison',
  'hilton garden inn madison': 'Hilton Garden Inn Madison',

  // Holiday Inn Express
  'hie tupelo': 'Holiday Inn Express Tupelo',
  'holiday inn express tupelo': 'Holiday Inn Express Tupelo',
  'hie fulton': 'Holiday Inn Express Fulton',
  'holiday inn express fulton': 'Holiday Inn Express Fulton',
  'hie memphis southwind': 'Holiday Inn Express Memphis Southwind',
  'hie southwind': 'Holiday Inn Express Memphis Southwind',
  'holiday inn express memphis southwind': 'Holiday Inn Express Memphis Southwind',

  // Holiday Inn
  'holiday inn tupelo': 'Holiday Inn Tupelo',
  'hi tupelo': 'Holiday Inn Tupelo',
  'holiday inn meridian': 'Holiday Inn Meridian',

  // Candlewood
  'candlewood suites': 'Candlewood Suites',
  'candlewood tupelo': 'Candlewood Suites',
  'candlewood suites fulton': 'Candlewood Suites',

  // Best Western
  'best western tupelo': 'Best Western Tupelo',
  'bw tupelo': 'Best Western Tupelo',
  'best western plus tupelo': 'Best Western Tupelo',
  'best western plus olive branch': 'Best Western Plus Olive Branch',
  'bw plus ob': 'Best Western Plus Olive Branch',
  'best western plus desoto': 'Best Western Plus Olive Branch',

  // Comfort Inn
  'comfort inn': 'Comfort Inn Tupelo',
  'comfort inn tupelo': 'Comfort Inn Tupelo',

  // TownePlace
  'towneplace suites': 'TownePlace Suites',
  'tps olive branch': 'TownePlace Suites',
  'towneplace olive branch': 'TownePlace Suites',

  // Four Points
  'four points memphis southwind': 'Four Points Memphis Southwind',
  'fp southwind': 'Four Points Memphis Southwind',
  'four points by sheraton memphis southwind': 'Four Points Memphis Southwind',

  // Hyatt
  'hyatt place biloxi': 'Hyatt Place Biloxi',
  'hyatt biloxi': 'Hyatt Place Biloxi',

  // Hampton Inn
  'hampton inn vicksburg': 'Hampton Inn Vicksburg',
  'hampton inn meridian': 'Hampton Inn Meridian',

  // DoubleTree
  'doubletree biloxi': 'DoubleTree Biloxi',
  'double tree biloxi': 'DoubleTree Biloxi',
  'doubletree by hilton biloxi': 'DoubleTree Biloxi',
};

// Pre-populate aliases with every canonical name's own normalized form so
// "home2 suites by hilton" (canonical input) still resolves via alias path.
for (const name of CANONICAL_NAMES) {
  ALIASES[normalizeForMatch(name)] = name;
}

export interface ResolveResult {
  /** Canonical property name (always one of CANONICAL_NAMES), or null if unresolved. */
  canonical: CanonicalProperty | null;
  /** The raw input, echoed back for logging / needs_review surfacing. */
  raw: string;
  /** Normalized key that was used for lookup — helpful for debugging. */
  normalizedKey: string;
}

/**
 * Resolve a raw property string to a canonical name. Pure, synchronous,
 * cache-free — lookup is O(1). Returns `canonical: null` when nothing
 * matched; caller decides whether to flag the row or drop it.
 */
export function resolveProperty(raw: string | null | undefined): ResolveResult {
  const input = (raw ?? '').trim();
  if (!input) return { canonical: null, raw: input, normalizedKey: '' };

  // Exact canonical match first — fast path.
  if (CANONICAL_SET.has(input)) {
    return { canonical: input as CanonicalProperty, raw: input, normalizedKey: input.toLowerCase() };
  }

  const key = normalizeForMatch(input);
  const alias = ALIASES[key];
  if (alias) {
    return { canonical: alias, raw: input, normalizedKey: key };
  }

  // Loose contains match — last resort, and only against unique substrings
  // that uniquely identify a hotel. Avoids accidentally matching
  // "Holiday Inn Tupelo" on a line that mentioned "Holiday Inn Express
  // Tupelo", because we check EXPRESS first.
  const orderedHints: Array<[RegExp, CanonicalProperty]> = [
    [/\bholiday inn express\s+fulton\b/, 'Holiday Inn Express Fulton'],
    [/\bholiday inn express\s+tupelo\b/, 'Holiday Inn Express Tupelo'],
    [/\bholiday inn express\s+memphis southwind\b/, 'Holiday Inn Express Memphis Southwind'],
    [/\bholiday inn\s+tupelo\b/, 'Holiday Inn Tupelo'],
    [/\bholiday inn\s+meridian\b/, 'Holiday Inn Meridian'],
    [/\bhilton garden inn\s+meridian\b/, 'Hilton Garden Inn Meridian'],
    [/\bhilton garden inn\s+madison\b/, 'Hilton Garden Inn Madison'],
    [/\bhilton garden inn\s+olive branch\b|\bhgi\s+olive branch\b/, 'HGI Olive Branch'],
    [/\bhampton inn\s+vicksburg\b/, 'Hampton Inn Vicksburg'],
    [/\bhampton inn\s+meridian\b/, 'Hampton Inn Meridian'],
    [/\bhome\s*2\s+suites\b/, 'Home2 Suites By Hilton'],
    [/\btru\s+by\s+hilton\s+tupelo\b/, 'Tru By Hilton Tupelo'],
    [/\bhyatt place\s+biloxi\b/, 'Hyatt Place Biloxi'],
    [/\bdoubletree\s+biloxi\b|\bdouble tree\s+biloxi\b/, 'DoubleTree Biloxi'],
    [/\btowneplace\b/, 'TownePlace Suites'],
    [/\bfour points\b/, 'Four Points Memphis Southwind'],
    [/\bcandlewood\b/, 'Candlewood Suites'],
    [/\bsurestay\b|\bsure stay\b/, 'SureStay Hotel'],
    [/\bbest western plus\b.*\bolive branch\b|\bbest western plus\b.*\bdesoto\b/, 'Best Western Plus Olive Branch'],
    [/\bbest western\b.*\btupelo\b/, 'Best Western Tupelo'],
    [/\bcomfort inn\b.*\btupelo\b|\bcomfort inn\b/, 'Comfort Inn Tupelo'],
  ];

  for (const [pattern, canonical] of orderedHints) {
    if (pattern.test(key)) {
      return { canonical, raw: input, normalizedKey: key };
    }
  }

  return { canonical: null, raw: input, normalizedKey: key };
}

/** Exposed for tests + admin UI so we can show "supported" list. */
export function listCanonicalNames(): readonly CanonicalProperty[] {
  return CANONICAL_NAMES;
}
