/**
 * Canonical property registry for Stoneriver HG portfolio.
 * Maps every known property to a code, canonical name, brand group, and fuzzy aliases.
 */

export interface PropertyMaster {
  code: string;
  canonicalName: string;
  brand: string;
  brandGroup: string;
  city: string;
  state: string;
  pmsType: string;
  reportFormat: string;
  aliases: string[];
}

export const PROPERTY_MASTER: PropertyMaster[] = [
  // ── Group 1: Hilton Standard ──────────────────────────────────────────────
  {
    code: 'HGIOB',
    canonicalName: 'HGI Olive Branch',
    brand: 'Hilton',
    brandGroup: 'Hilton',
    city: 'Olive Branch',
    state: 'MS',
    pmsType: 'hilton_statistics',
    reportFormat: 'Hilton Hotel Statistics',
    aliases: [
      'hgi olive branch', 'hilton garden inn olive branch', 'hgi ob',
      'olive branch hgi', 'hilton garden olive branch', 'hgi olbr',
    ],
  },
  {
    code: 'TRUTP',
    canonicalName: 'Tru By Hilton Tupelo',
    brand: 'Hilton',
    brandGroup: 'Hilton',
    city: 'Tupelo',
    state: 'MS',
    pmsType: 'hilton_statistics',
    reportFormat: 'Hilton Hotel Statistics',
    aliases: [
      'tru by hilton tupelo', 'tru tupelo', 'tru hilton tupelo',
      'tru by hilton', 'tru', 'tbh tupelo',
    ],
  },
  {
    code: 'HAMPVK',
    canonicalName: 'Hampton Inn Vicksburg',
    brand: 'Hilton',
    brandGroup: 'Hilton',
    city: 'Vicksburg',
    state: 'MS',
    pmsType: 'hilton_statistics',
    reportFormat: 'Hilton Hotel Statistics',
    aliases: [
      'hampton inn vicksburg', 'hampton vicksburg', 'hi vicksburg',
      'hampton vburg', 'hmptn vicksburg',
    ],
  },
  {
    code: 'DTBLX',
    canonicalName: 'DoubleTree Biloxi',
    brand: 'Hilton',
    brandGroup: 'Hilton',
    city: 'Biloxi',
    state: 'MS',
    pmsType: 'hilton_statistics',
    reportFormat: 'Hilton Hotel Statistics',
    aliases: [
      'doubletree biloxi', 'dt biloxi', 'double tree biloxi',
      'doubletree blx', 'dbl tree biloxi',
    ],
  },

  // ── Group 2: Hilton Extended ──────────────────────────────────────────────
  {
    code: 'HM2BX',
    canonicalName: 'Home2 Suites By Hilton',
    brand: 'Hilton',
    brandGroup: 'Hilton Extended',
    city: 'Biloxi',
    state: 'MS',
    pmsType: 'hilton_statistics_ext',
    reportFormat: 'Hilton Hotel Statistics Extended',
    aliases: [
      'home2 suites by hilton', 'home2 suites', 'home2 biloxi',
      'home 2 suites', 'h2s biloxi', 'home2',
    ],
  },
  {
    code: 'HGIMD',
    canonicalName: 'Hilton Garden Inn Madison',
    brand: 'Hilton',
    brandGroup: 'Hilton Extended',
    city: 'Madison',
    state: 'MS',
    pmsType: 'hilton_statistics_ext',
    reportFormat: 'Hilton Hotel Statistics Extended',
    aliases: [
      'hilton garden inn madison', 'hgi madison', 'hilton garden madison',
      'hgi mad', 'garden inn madison',
    ],
  },
  {
    code: 'HGIMR',
    canonicalName: 'Hilton Garden Inn Meridian',
    brand: 'Hilton',
    brandGroup: 'Hilton Extended',
    city: 'Meridian',
    state: 'MS',
    pmsType: 'hilton_statistics_ext',
    reportFormat: 'Hilton Hotel Statistics Extended',
    aliases: [
      'hilton garden inn meridian', 'hgi meridian', 'hilton garden meridian',
      'hgi mer', 'garden inn meridian',
    ],
  },
  {
    code: 'HAMPMR',
    canonicalName: 'Hampton Inn Meridian',
    brand: 'Hilton',
    brandGroup: 'Hilton Extended',
    city: 'Meridian',
    state: 'MS',
    pmsType: 'hilton_statistics_ext',
    reportFormat: 'Hilton Hotel Statistics Extended',
    aliases: [
      'hampton inn meridian', 'hampton meridian', 'hi meridian',
      'hmptn meridian',
    ],
  },

  // ── Group 3: IHG ──────────────────────────────────────────────────────────
  {
    code: 'HIMRD',
    canonicalName: 'Holiday Inn Meridian',
    brand: 'IHG',
    brandGroup: 'IHG',
    city: 'Meridian',
    state: 'MS',
    pmsType: 'ihg_manager_flash',
    reportFormat: 'IHG Manager Flash',
    aliases: [
      'holiday inn meridian', 'hi meridian', 'holiday meridian',
    ],
  },
  {
    code: 'CWSTP',
    canonicalName: 'Candlewood Suites',
    brand: 'IHG',
    brandGroup: 'IHG',
    city: 'Tupelo',
    state: 'MS',
    pmsType: 'ihg_manager_flash',
    reportFormat: 'IHG Manager Flash',
    aliases: [
      'candlewood suites', 'candlewood', 'cws tupelo', 'candlewood tupelo',
    ],
  },
  {
    code: 'HIEFT',
    canonicalName: 'Holiday Inn Express Fulton',
    brand: 'IHG',
    brandGroup: 'IHG',
    city: 'Fulton',
    state: 'MS',
    pmsType: 'ihg_manager_flash',
    reportFormat: 'IHG Manager Flash',
    aliases: [
      'holiday inn express fulton', 'hie fulton', 'hiex fulton',
      'hi express fulton', 'hix fulton',
    ],
  },
  {
    code: 'HIEMSW',
    canonicalName: 'Holiday Inn Express Memphis Southwind',
    brand: 'IHG',
    brandGroup: 'IHG',
    city: 'Memphis',
    state: 'TN',
    pmsType: 'ihg_manager_flash',
    reportFormat: 'IHG Manager Flash',
    aliases: [
      'holiday inn express memphis southwind', 'hie memphis southwind',
      'hiex memphis', 'hie memphis', 'hi express memphis',
      'holiday inn express memphis', 'hie msw',
    ],
  },
  {
    code: 'HIETP',
    canonicalName: 'Holiday Inn Express Tupelo',
    brand: 'IHG',
    brandGroup: 'IHG',
    city: 'Tupelo',
    state: 'MS',
    pmsType: 'ihg_manager_flash',
    reportFormat: 'IHG Manager Flash',
    aliases: [
      'holiday inn express tupelo', 'hie tupelo', 'hiex tupelo',
      'hi express tupelo', 'hix tupelo',
    ],
  },
  {
    code: 'HITP',
    canonicalName: 'Holiday Inn Tupelo',
    brand: 'IHG',
    brandGroup: 'IHG',
    city: 'Tupelo',
    state: 'MS',
    pmsType: 'ihg_manager_flash',
    reportFormat: 'IHG Manager Flash',
    aliases: [
      'holiday inn tupelo', 'hi tupelo', 'holiday tupelo',
    ],
  },

  // ── Group 4: Marriott (Four Points) ────────────────────────────────────────
  {
    code: 'FPMSW',
    canonicalName: 'Four Points Memphis Southwind',
    brand: 'Marriott',
    brandGroup: 'Marriott',
    city: 'Memphis',
    state: 'TN',
    pmsType: 'marriott_manager_stats',
    reportFormat: 'Marriott Manager Statistics',
    aliases: [
      'four points memphis southwind', 'four points memphis',
      'fp memphis', 'fp southwind', 'four points',
      'four points by sheraton memphis',
    ],
  },

  // ── Group 7: Marriott Revenue (TownePlace) ────────────────────────────────
  {
    code: 'TPSRG',
    canonicalName: 'TownePlace Suites',
    brand: 'Marriott',
    brandGroup: 'Marriott',
    city: 'Ridgeland',
    state: 'MS',
    pmsType: 'marriott_revenue',
    reportFormat: 'Marriott Revenue Report',
    aliases: [
      'towneplace suites', 'towneplace', 'tps ridgeland',
      'towne place suites', 'tps',
    ],
  },

  // ── Group 5: Best Western ──────────────────────────────────────────────────
  {
    code: 'BWTP',
    canonicalName: 'Best Western Tupelo',
    brand: 'Best Western',
    brandGroup: 'Best Western',
    city: 'Tupelo',
    state: 'MS',
    pmsType: 'best_western_daily',
    reportFormat: 'Best Western Daily',
    aliases: [
      'best western tupelo', 'bw tupelo', 'best western',
    ],
  },
  {
    code: 'SSTP',
    canonicalName: 'SureStay Hotel',
    brand: 'Best Western',
    brandGroup: 'Best Western',
    city: 'Tupelo',
    state: 'MS',
    pmsType: 'best_western_daily',
    reportFormat: 'Best Western Daily',
    aliases: [
      'surestay hotel', 'surestay', 'sure stay', 'surestay tupelo',
      'ss tupelo', 'surestay hotel tupelo',
    ],
  },
  {
    code: 'BWPOB',
    canonicalName: 'Best Western Plus Olive Branch',
    brand: 'Best Western',
    brandGroup: 'Best Western',
    city: 'Olive Branch',
    state: 'MS',
    pmsType: 'best_western_daily',
    reportFormat: 'Best Western Daily',
    aliases: [
      'best western plus olive branch', 'bwp olive branch', 'bw plus ob',
      'bw olive branch', 'best western ob', 'bwp ob',
    ],
  },

  // ── Group 6: Hyatt ────────────────────────────────────────────────────────
  {
    code: 'HYPBX',
    canonicalName: 'Hyatt Place Biloxi',
    brand: 'Hyatt',
    brandGroup: 'Hyatt',
    city: 'Biloxi',
    state: 'MS',
    pmsType: 'hyatt_manager_flash',
    reportFormat: 'Hyatt Manager Flash',
    aliases: [
      'hyatt place biloxi', 'hyatt biloxi', 'hp biloxi',
      'hyatt place blx',
    ],
  },

  // ── Group 8: Choice ────────────────────────────────────────────────────────
  {
    code: 'CITP',
    canonicalName: 'Comfort Inn Tupelo',
    brand: 'Choice',
    brandGroup: 'Choice',
    city: 'Tupelo',
    state: 'MS',
    pmsType: 'choice_statistics',
    reportFormat: 'Choice Hotels Statistics',
    aliases: [
      'comfort inn tupelo', 'comfort inn', 'ci tupelo',
      'comfort tupelo',
    ],
  },
];

/**
 * Fuzzy match a folder/file name against the property master.
 * Returns the best match with a confidence score.
 */
export function matchProperty(
  input: string,
): { property: PropertyMaster; confidence: number } | null {
  const normalized = input.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  let bestMatch: PropertyMaster | null = null;
  let bestScore = 0;

  for (const prop of PROPERTY_MASTER) {
    // Exact canonical match.
    if (normalized === prop.canonicalName.toLowerCase()) {
      return { property: prop, confidence: 1.0 };
    }

    // Check aliases.
    for (const alias of prop.aliases) {
      const aliasNorm = alias.toLowerCase();

      // Exact alias match.
      if (normalized === aliasNorm || normalized.includes(aliasNorm)) {
        const score = aliasNorm.length / Math.max(normalized.length, aliasNorm.length);
        const adjustedScore = Math.min(0.95, 0.7 + score * 0.3);
        if (adjustedScore > bestScore) {
          bestScore = adjustedScore;
          bestMatch = prop;
        }
      }

      // Token-based similarity.
      const inputTokens = new Set(normalized.split(' '));
      const aliasTokens = alias.toLowerCase().split(' ');
      const matchedTokens = aliasTokens.filter((t) => inputTokens.has(t));

      if (matchedTokens.length > 0) {
        const tokenScore = matchedTokens.length / aliasTokens.length;
        const adjustedScore = Math.min(0.85, 0.4 + tokenScore * 0.45);
        if (adjustedScore > bestScore) {
          bestScore = adjustedScore;
          bestMatch = prop;
        }
      }
    }
  }

  if (bestMatch && bestScore >= 0.4) {
    return { property: bestMatch, confidence: bestScore };
  }

  return null;
}

/**
 * Normalize a property name for display (short form).
 * If the canonical name exceeds maxLength, abbreviate intelligently.
 */
export function shortPropertyName(canonicalName: string, maxLength: number = 30): string {
  if (canonicalName.length <= maxLength) return canonicalName.replace(/\s+/g, '');

  const abbreviations: Record<string, string> = {
    'Holiday Inn Express': 'HIExpress',
    'Holiday Inn': 'HolidayInn',
    'Hilton Garden Inn': 'HGI',
    'Hampton Inn': 'HamptonInn',
    'Best Western Plus': 'BWPlus',
    'Best Western': 'BestWestern',
    'Home2 Suites By Hilton': 'Home2Suites',
    'Four Points': 'FourPoints',
    'TownePlace Suites': 'TownePlace',
    'Tru By Hilton': 'TruByHilton',
    'Comfort Inn': 'ComfortInn',
    'Candlewood Suites': 'Candlewood',
    'Hyatt Place': 'HyattPlace',
    'SureStay Hotel': 'SureStay',
    'DoubleTree': 'DoubleTree',
  };

  let result = canonicalName;
  for (const [full, short] of Object.entries(abbreviations)) {
    if (result.startsWith(full)) {
      result = result.replace(full, short);
      break;
    }
  }

  return result.replace(/\s+/g, '').slice(0, maxLength);
}
