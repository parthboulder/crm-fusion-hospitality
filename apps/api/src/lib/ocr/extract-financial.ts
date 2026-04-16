/**
 * Regex-based financial data extractor. Runs on raw OCR text and pulls out
 * the fields the spec calls out: revenue, expenses, dates, categories.
 *
 * Deterministic by design — no LLM dependency so the worker stays fast and
 * offline-capable. An LLM pass can be layered on top later.
 */

export interface FinancialLine {
  label: string;
  amount: number;
  raw: string;
}

export interface ExtractedFinancialData {
  revenue: FinancialLine[];
  expenses: FinancialLine[];
  dates: string[];
  categories: string[];
  totals: {
    totalRevenue: number | null;
    totalExpenses: number | null;
    netIncome: number | null;
  };
  /** Confidence [0, 1] that the extraction was meaningful (non-empty + looked financial). */
  confidence: number;
}

const REVENUE_KEYWORDS = [
  'revenue', 'room revenue', 'rooms revenue', 'f&b revenue', 'food and beverage',
  'other revenue', 'total revenue', 'gross revenue', 'net revenue', 'sales',
  'rooms sold', 'adr', 'revpar', 'occupancy',
];

const EXPENSE_KEYWORDS = [
  'expense', 'expenses', 'cost', 'payroll', 'labor', 'commission',
  'utilities', 'supplies', 'maintenance', 'insurance', 'tax', 'taxes',
  'fees', 'rent', 'operating expense', 'total expenses',
];

const CATEGORY_KEYWORDS = [
  'rooms', 'food and beverage', 'f&b', 'banquets', 'spa', 'retail',
  'parking', 'telecom', 'other operated', 'rentals', 'miscellaneous',
  'administrative', 'sales and marketing', 'property operations',
];

// Currency amount: $1,234.56 or 1234.56 or (1,234.56) for negatives.
const AMOUNT_RE = /\(?\$?\s*(-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*\)?/;

// Dates: 2026-04-15, 04/15/2026, 15-Apr-2026, April 15 2026
const DATE_PATTERNS: RegExp[] = [
  /\b(\d{4}-\d{2}-\d{2})\b/g,
  /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g,
  /\b(\d{1,2}-[A-Za-z]{3}-\d{2,4})\b/g,
  /\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b/gi,
];

function parseAmount(s: string): number | null {
  const m = s.match(AMOUNT_RE);
  if (!m || !m[1]) return null;
  const raw = m[1].replace(/,/g, '');
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return null;
  // Detect parenthesized negatives: (1,234) → -1234
  return s.includes('(') && s.includes(')') ? -Math.abs(n) : n;
}

function hasKeyword(line: string, kws: string[]): string | null {
  const lower = line.toLowerCase();
  for (const kw of kws) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

export function extractFinancialData(text: string): ExtractedFinancialData {
  const revenue: FinancialLine[] = [];
  const expenses: FinancialLine[] = [];
  const dates = new Set<string>();
  const categories = new Set<string>();

  // Line-level scan for labeled amounts.
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 300) continue;

    const amount = parseAmount(trimmed);
    if (amount === null) continue;

    const revKw = hasKeyword(trimmed, REVENUE_KEYWORDS);
    const expKw = hasKeyword(trimmed, EXPENSE_KEYWORDS);

    // Extract label = text before the first amount-looking token.
    const firstAmountIdx = trimmed.search(/\(?\$?\s*-?\d{1,3}(?:,\d{3})*/);
    const label = firstAmountIdx > 0
      ? trimmed.slice(0, firstAmountIdx).trim().replace(/[:\-\.]+$/, '').trim()
      : trimmed;

    if (!label || label.length > 120) continue;

    if (revKw) {
      revenue.push({ label, amount, raw: trimmed });
    } else if (expKw) {
      expenses.push({ label, amount, raw: trimmed });
    }

    const catKw = hasKeyword(trimmed, CATEGORY_KEYWORDS);
    if (catKw) categories.add(catKw);
  }

  // Dates across the full text.
  for (const re of DATE_PATTERNS) {
    for (const m of text.matchAll(re)) {
      if (m[1]) dates.add(m[1]);
    }
  }

  // Heuristic totals: look for lines matching "total revenue"/"total expenses"/"net income".
  const totalRevenue = findTotal(lines, /total\s+(?:gross\s+)?revenue|gross\s+revenue/i);
  const totalExpenses = findTotal(lines, /total\s+(?:operating\s+)?expenses?/i);
  const netIncome = findTotal(lines, /net\s+income|net\s+profit|net\s+operating\s+income|noi/i);

  const signalCount = revenue.length + expenses.length + dates.size;
  const confidence = Math.min(1, signalCount / 10);

  return {
    revenue,
    expenses,
    dates: [...dates],
    categories: [...categories],
    totals: { totalRevenue, totalExpenses, netIncome },
    confidence,
  };
}

function findTotal(lines: string[], re: RegExp): number | null {
  for (const line of lines) {
    if (re.test(line)) {
      const a = parseAmount(line);
      if (a !== null) return a;
    }
  }
  return null;
}
