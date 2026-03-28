/**
 * Canonical report type registry for hotel daily reporting.
 * Maps report types to file patterns, expected extensions, priority, and extraction metadata.
 */

export interface ReportType {
  canonicalName: string;
  slug: string;
  category: 'key_report' | 'supporting_report' | 'operational' | 'financial';
  priority: 'critical' | 'high' | 'medium' | 'low';
  expectedExtensions: string[];
  storageMode: 'individual' | 'bundle';
  filenamePatterns: RegExp[];
  keywordsInFilename: string[];
  primaryPurpose: string;
  extractionFields: ExtractionField[];
}

export interface ExtractionField {
  field: string;
  description: string;
  useCase: 'flash_reporting' | 'operations' | 'accounting' | 'executive' | 'controls';
  priority: 'critical' | 'high' | 'medium' | 'low';
}

export const REPORT_TYPES: ReportType[] = [
  // ── Revenue & Performance ─────────────────────────────────────────────────
  {
    canonicalName: 'Revenue Flash',
    slug: 'revenue-flash',
    category: 'key_report',
    priority: 'critical',
    expectedExtensions: ['.xlsx', '.xls', '.csv'],
    storageMode: 'individual',
    filenamePatterns: [
      /revenue\s*flash/i,
      /rev\s*flash/i,
      /flash\s*drive/i,
      /revenue\s*flash\s*drive/i,
    ],
    keywordsInFilename: ['revenue', 'flash', 'drive'],
    primaryPurpose: 'Daily revenue snapshot with occupancy, ADR, RevPAR, and year-over-year comparisons',
    extractionFields: [
      { field: 'occupancy_pct', description: 'Occupancy percentage (day/MTD/YTD)', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'adr', description: 'Average Daily Rate (day/MTD/YTD)', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'revpar', description: 'Revenue Per Available Room (day/MTD/YTD)', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'rooms_sold', description: 'Total rooms sold', useCase: 'operations', priority: 'critical' },
      { field: 'room_revenue', description: 'Total room revenue (day/MTD/YTD)', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'ooo_rooms', description: 'Out-of-order room count', useCase: 'operations', priority: 'high' },
      { field: 'py_revenue', description: 'Prior year revenue comparison', useCase: 'executive', priority: 'high' },
      { field: 'py_occupancy', description: 'Prior year occupancy comparison', useCase: 'executive', priority: 'high' },
      { field: 'py_adr', description: 'Prior year ADR comparison', useCase: 'executive', priority: 'medium' },
      { field: 'budget_variance', description: 'Budget vs actual variance', useCase: 'executive', priority: 'medium' },
      { field: 'forecast_occupancy', description: 'Forecast occupancy', useCase: 'operations', priority: 'medium' },
    ],
  },

  {
    canonicalName: 'Daily Report Statistical Recap',
    slug: 'daily-statistical-recap',
    category: 'key_report',
    priority: 'critical',
    expectedExtensions: ['.pdf'],
    storageMode: 'individual',
    filenamePatterns: [
      /daily\s*report\s*statistical\s*recap/i,
      /statistical\s*recap/i,
      /daily\s*stat/i,
      /daily\s*report/i,
      /stat\s*recap/i,
    ],
    keywordsInFilename: ['daily', 'report', 'statistical', 'recap', 'stat'],
    primaryPurpose: 'High-level daily operating KPIs including business mix and segmentation',
    extractionFields: [
      { field: 'occupancy_pct', description: 'Occupancy percentage', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'adr', description: 'Average Daily Rate', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'revpar', description: 'Revenue Per Available Room', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'rooms_sold', description: 'Total rooms sold', useCase: 'operations', priority: 'critical' },
      { field: 'room_revenue', description: 'Total room revenue', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'business_mix', description: 'Transient vs group vs contract segmentation', useCase: 'operations', priority: 'high' },
      { field: 'comp_rooms', description: 'Complimentary rooms count', useCase: 'controls', priority: 'medium' },
      { field: 'house_use_rooms', description: 'House use rooms count', useCase: 'controls', priority: 'medium' },
      { field: 'no_shows', description: 'No-show count', useCase: 'operations', priority: 'low' },
    ],
  },

  {
    canonicalName: 'Manager Flash Report',
    slug: 'manager-flash',
    category: 'key_report',
    priority: 'critical',
    expectedExtensions: ['.pdf'],
    storageMode: 'individual',
    filenamePatterns: [
      /manager\s*flash/i,
      /mgr\s*flash/i,
      /manager\s*report/i,
      /flash\s*report/i,
    ],
    keywordsInFilename: ['manager', 'flash', 'mgr'],
    primaryPurpose: 'Brand-specific manager summary with day/MTD/YTD performance metrics',
    extractionFields: [
      { field: 'occupancy_pct', description: 'Occupancy percentage (day/MTD/YTD)', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'adr', description: 'Average Daily Rate (day/MTD/YTD)', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'revpar', description: 'Revenue Per Available Room (day/MTD/YTD)', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'rooms_sold', description: 'Total rooms sold', useCase: 'operations', priority: 'critical' },
      { field: 'room_revenue', description: 'Room revenue (day/MTD/YTD)', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'ooo_rooms', description: 'Out-of-order rooms', useCase: 'operations', priority: 'high' },
      { field: 'py_revenue', description: 'Prior year revenue', useCase: 'executive', priority: 'high' },
    ],
  },

  // ── Financial & Accounting ────────────────────────────────────────────────
  {
    canonicalName: 'Aging Report',
    slug: 'aging-report',
    category: 'financial',
    priority: 'high',
    expectedExtensions: ['.pdf'],
    storageMode: 'individual',
    filenamePatterns: [
      /aging\s*report/i,
      /a\s*r\s*aging/i,
      /accounts?\s*receivable\s*aging/i,
      /aging/i,
    ],
    keywordsInFilename: ['aging', 'ar', 'receivable'],
    primaryPurpose: 'Accounts receivable aging with bucket breakdown for collections follow-up',
    extractionFields: [
      { field: 'ar_current', description: 'Current (0-30 days) receivables balance', useCase: 'accounting', priority: 'critical' },
      { field: 'ar_30_days', description: '31-60 day receivables', useCase: 'accounting', priority: 'critical' },
      { field: 'ar_60_days', description: '61-90 day receivables', useCase: 'accounting', priority: 'critical' },
      { field: 'ar_90_plus_days', description: '90+ day receivables', useCase: 'accounting', priority: 'critical' },
      { field: 'ar_total', description: 'Total receivables outstanding', useCase: 'executive', priority: 'critical' },
      { field: 'major_balances', description: 'Individual accounts over threshold', useCase: 'controls', priority: 'high' },
      { field: 'collection_notes', description: 'Notes on major overdue accounts', useCase: 'operations', priority: 'medium' },
    ],
  },

  {
    canonicalName: 'Credit Card Transactions Report',
    slug: 'credit-card-transactions',
    category: 'financial',
    priority: 'high',
    expectedExtensions: ['.pdf'],
    storageMode: 'individual',
    filenamePatterns: [
      /credit\s*card\s*transaction/i,
      /cc\s*transaction/i,
      /credit\s*card/i,
      /card\s*transaction/i,
    ],
    keywordsInFilename: ['credit', 'card', 'transaction', 'cc'],
    primaryPurpose: 'Card settlement totals by type for reconciliation and exception detection',
    extractionFields: [
      { field: 'cc_visa', description: 'Visa settlement total', useCase: 'accounting', priority: 'high' },
      { field: 'cc_mastercard', description: 'Mastercard settlement total', useCase: 'accounting', priority: 'high' },
      { field: 'cc_amex', description: 'Amex settlement total', useCase: 'accounting', priority: 'high' },
      { field: 'cc_discover', description: 'Discover settlement total', useCase: 'accounting', priority: 'high' },
      { field: 'cc_other', description: 'Other card settlement total', useCase: 'accounting', priority: 'medium' },
      { field: 'cc_total', description: 'Total card settlements', useCase: 'controls', priority: 'critical' },
      { field: 'cc_disputes', description: 'Dispute/chargeback count or amount', useCase: 'controls', priority: 'high' },
      { field: 'settlement_date', description: 'Settlement batch date', useCase: 'accounting', priority: 'medium' },
    ],
  },

  {
    canonicalName: 'Room & Tax Listing Report',
    slug: 'room-tax-listing',
    category: 'financial',
    priority: 'high',
    expectedExtensions: ['.pdf'],
    storageMode: 'individual',
    filenamePatterns: [
      /room\s*(&|and)\s*tax\s*listing/i,
      /room\s*tax\s*listing/i,
      /room\s*tax/i,
      /tax\s*listing/i,
    ],
    keywordsInFilename: ['room', 'tax', 'listing'],
    primaryPurpose: 'Room revenue and tax detail by room for rate validation and tax compliance',
    extractionFields: [
      { field: 'total_room_revenue', description: 'Sum of all room charges', useCase: 'accounting', priority: 'critical' },
      { field: 'total_tax_collected', description: 'Total tax collected', useCase: 'accounting', priority: 'critical' },
      { field: 'tax_exempt_amount', description: 'Tax-exempt room revenue', useCase: 'controls', priority: 'high' },
      { field: 'room_count', description: 'Number of rooms on listing', useCase: 'operations', priority: 'medium' },
      { field: 'rate_anomalies', description: 'Rooms with rates outside normal band', useCase: 'controls', priority: 'medium' },
      { field: 'tax_rate_validation', description: 'Effective tax rate vs expected', useCase: 'controls', priority: 'low' },
    ],
  },

  // ── Operational ───────────────────────────────────────────────────────────
  {
    canonicalName: 'Operator Transactions Report',
    slug: 'operator-transactions',
    category: 'operational',
    priority: 'high',
    expectedExtensions: ['.pdf'],
    storageMode: 'individual',
    filenamePatterns: [
      /operator\s*transaction/i,
      /op\s*transaction/i,
      /operator\s*report/i,
    ],
    keywordsInFilename: ['operator', 'transaction'],
    primaryPurpose: 'Adjustments, comps, paid-outs, refunds, and corrections by operator',
    extractionFields: [
      { field: 'adjustments_total', description: 'Total adjustments amount', useCase: 'controls', priority: 'critical' },
      { field: 'comps_total', description: 'Total complimentary charges', useCase: 'controls', priority: 'critical' },
      { field: 'voids_total', description: 'Total voids amount', useCase: 'controls', priority: 'critical' },
      { field: 'refunds_total', description: 'Total refunds amount', useCase: 'controls', priority: 'high' },
      { field: 'paid_outs', description: 'Total paid-out amounts', useCase: 'controls', priority: 'high' },
      { field: 'operator_detail', description: 'Breakdown by operator ID', useCase: 'controls', priority: 'medium' },
      { field: 'unusual_transactions', description: 'Flagged high-value or off-hours transactions', useCase: 'controls', priority: 'high' },
    ],
  },

  {
    canonicalName: 'Daily Transaction Log Report',
    slug: 'daily-transaction-log',
    category: 'operational',
    priority: 'medium',
    expectedExtensions: ['.pdf'],
    storageMode: 'individual',
    filenamePatterns: [
      /daily\s*transaction\s*log/i,
      /transaction\s*log/i,
      /daily\s*log/i,
      /dtl\s*report/i,
    ],
    keywordsInFilename: ['daily', 'transaction', 'log'],
    primaryPurpose: 'Detailed audit trail of all transactions for exception investigation',
    extractionFields: [
      { field: 'total_transactions', description: 'Transaction count for the day', useCase: 'operations', priority: 'medium' },
      { field: 'exception_flags', description: 'Unusual or flagged transactions', useCase: 'controls', priority: 'high' },
      { field: 'late_checkouts', description: 'Late checkout charges', useCase: 'operations', priority: 'low' },
      { field: 'misc_charges', description: 'Miscellaneous charges total', useCase: 'accounting', priority: 'low' },
    ],
  },

  {
    canonicalName: 'OOO Rooms Report',
    slug: 'ooo-rooms',
    category: 'operational',
    priority: 'high',
    expectedExtensions: ['.xlsx', '.xls', '.csv', '.pdf'],
    storageMode: 'individual',
    filenamePatterns: [
      /ooo\s*room/i,
      /out\s*of\s*order/i,
      /out\s*of\s*service/i,
      /oos\s*room/i,
      /down\s*room/i,
    ],
    keywordsInFilename: ['ooo', 'out', 'order', 'service', 'down', 'room'],
    primaryPurpose: 'Out-of-order room inventory with room numbers and maintenance impact',
    extractionFields: [
      { field: 'ooo_count', description: 'Total OOO/OOS room count', useCase: 'operations', priority: 'critical' },
      { field: 'room_numbers', description: 'Specific room numbers OOO', useCase: 'operations', priority: 'high' },
      { field: 'reason_codes', description: 'Reason for OOO (maintenance, renovation, etc.)', useCase: 'operations', priority: 'high' },
      { field: 'expected_return', description: 'Expected return-to-service dates', useCase: 'operations', priority: 'medium' },
      { field: 'sellable_impact', description: 'Impact on sellable inventory count', useCase: 'flash_reporting', priority: 'high' },
    ],
  },

  // ── Supporting / Supplementary ────────────────────────────────────────────
  {
    canonicalName: 'Hotel Statistics Report',
    slug: 'hotel-statistics',
    category: 'key_report',
    priority: 'critical',
    expectedExtensions: ['.pdf'],
    storageMode: 'individual',
    filenamePatterns: [
      /hotel\s*statistics/i,
      /htl\s*stat/i,
      /property\s*statistics/i,
    ],
    keywordsInFilename: ['hotel', 'statistics', 'htl', 'stat'],
    primaryPurpose: 'Hilton-format comprehensive daily statistics with performance and revenue data',
    extractionFields: [
      { field: 'occupancy_pct', description: 'Occupancy percentage', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'adr', description: 'Average Daily Rate', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'revpar', description: 'RevPAR', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'total_rooms', description: 'Total rooms in inventory', useCase: 'operations', priority: 'high' },
      { field: 'rooms_sold', description: 'Rooms sold', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'room_revenue', description: 'Room revenue', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'ooo_rooms', description: 'OOO room count', useCase: 'operations', priority: 'high' },
      { field: 'py_room_revenue', description: 'Prior year room revenue', useCase: 'executive', priority: 'high' },
    ],
  },

  {
    canonicalName: 'Marriott Manager Statistics Report',
    slug: 'marriott-manager-stats',
    category: 'key_report',
    priority: 'critical',
    expectedExtensions: ['.pdf'],
    storageMode: 'individual',
    filenamePatterns: [
      /marriott\s*manager\s*stat/i,
      /manager\s*statistics/i,
      /mgr\s*stat/i,
    ],
    keywordsInFilename: ['manager', 'statistics', 'marriott'],
    primaryPurpose: 'Marriott-format manager statistics with occupancy, rate, and revenue metrics',
    extractionFields: [
      { field: 'occupancy_pct', description: 'Occupancy % less comp', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'adr', description: 'Net avg rate less comp', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'rooms_sold', description: 'Rooms occupied', useCase: 'operations', priority: 'critical' },
      { field: 'room_revenue', description: 'Room revenue', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'ooo_rooms', description: 'Out of order rooms', useCase: 'operations', priority: 'high' },
    ],
  },

  {
    canonicalName: 'Marriott Revenue Report',
    slug: 'marriott-revenue',
    category: 'key_report',
    priority: 'critical',
    expectedExtensions: ['.pdf'],
    storageMode: 'individual',
    filenamePatterns: [
      /marriott\s*revenue/i,
      /revenue\s*report/i,
    ],
    keywordsInFilename: ['marriott', 'revenue', 'report'],
    primaryPurpose: 'Marriott-format revenue report with day/MTD/YTD breakdowns and prior year',
    extractionFields: [
      { field: 'occupancy_pct', description: 'Occupancy PCT (day/MTD/YTD)', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'adr', description: 'Avg rate per room (day/MTD/YTD)', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'revpar', description: 'RevPAR (day/MTD/YTD)', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'total_room_sales', description: 'Total room sales (day/MTD/YTD)', useCase: 'flash_reporting', priority: 'critical' },
      { field: 'py_room_sales', description: 'Prior year room sales', useCase: 'executive', priority: 'high' },
      { field: 'ooo_rooms', description: 'Out of order rooms', useCase: 'operations', priority: 'high' },
    ],
  },
];

/**
 * Expected report set per daily property package.
 * Key reports are required; supporting reports are expected but not mandatory.
 */
export const EXPECTED_DAILY_REPORTS = {
  key: [
    'revenue-flash',
    'daily-statistical-recap',
  ],
  financial: [
    'aging-report',
    'credit-card-transactions',
    'room-tax-listing',
  ],
  operational: [
    'operator-transactions',
    'daily-transaction-log',
    'ooo-rooms',
  ],
} as const;

/**
 * Brand-specific primary report (used instead of generic daily-statistical-recap).
 */
export const BRAND_PRIMARY_REPORT: Record<string, string> = {
  'Hilton': 'hotel-statistics',
  'Hilton Extended': 'hotel-statistics',
  'IHG': 'manager-flash',
  'Marriott': 'marriott-manager-stats',
  'Best Western': 'daily-statistical-recap',
  'Hyatt': 'manager-flash',
  'Choice': 'hotel-statistics',
};

/**
 * Match a filename to a report type.
 * Returns the best match with a confidence score.
 */
export function matchReportType(
  filename: string,
  extension: string,
): { reportType: ReportType; confidence: number } | null {
  const normalized = filename
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let bestMatch: ReportType | null = null;
  let bestScore = 0;

  for (const rt of REPORT_TYPES) {
    // Regex pattern match (highest confidence).
    for (const pattern of rt.filenamePatterns) {
      if (pattern.test(normalized) || pattern.test(filename)) {
        const score = 0.9;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = rt;
        }
      }
    }

    // Keyword match.
    const inputTokens = new Set(normalized.split(' '));
    const matchedKeywords = rt.keywordsInFilename.filter((kw) => {
      return inputTokens.has(kw) || normalized.includes(kw);
    });

    if (matchedKeywords.length >= 2) {
      const score = Math.min(0.85, 0.5 + (matchedKeywords.length / rt.keywordsInFilename.length) * 0.35);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = rt;
      }
    }
  }

  // Extension validation bonus/penalty.
  if (bestMatch) {
    const extLower = extension.toLowerCase();
    if (bestMatch.expectedExtensions.includes(extLower)) {
      bestScore = Math.min(1.0, bestScore + 0.05);
    } else {
      bestScore = Math.max(0.3, bestScore - 0.1);
    }
  }

  if (bestMatch && bestScore >= 0.4) {
    return { reportType: bestMatch, confidence: bestScore };
  }

  return null;
}
