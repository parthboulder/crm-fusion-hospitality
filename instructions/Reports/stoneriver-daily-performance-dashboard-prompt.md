# Prompt: Build Stoneriver HG Daily Hotel Performance Dashboard

## Context

You are building a view for Stoneriver HG, a third-party hotel management company that operates 21 properties across Mississippi, Tennessee, and Texas. Each property sends a nightly report in one of 8 different PMS/brand report formats (Hilton, IHG, Marriott, Hyatt, Best Western, Choice). A separate extraction pipeline parses these reports and writes structured data to the database. This view is the **consolidated daily performance dashboard** that leadership uses every morning to see how every property performed.

## Tech Stack

- **Frontend:** React + Tailwind CSS
- **Backend/DB:** Supabase (PostgreSQL + Row Level Security)
- **Design System:** Clean editorial aesthetic — flat surfaces, 0.5px borders, no shadows, minimal color, strong typography hierarchy. Think Bloomberg Terminal meets a well-designed spreadsheet.

## Database Schema

Create a Supabase table called `daily_hotel_performance` with the following columns:

```sql
CREATE TABLE daily_hotel_performance (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  property_name TEXT NOT NULL,
  property_group TEXT NOT NULL,        -- e.g. "Hilton Standard", "IHG Flash", "Marriott Revenue"
  report_date DATE NOT NULL,
  
  -- Performance KPIs
  occupancy_day NUMERIC(5,2),          -- Day occupancy %
  occupancy_mtd NUMERIC(5,2),          -- MTD occupancy %
  occupancy_ytd NUMERIC(5,2),          -- YTD occupancy %
  
  adr_day NUMERIC(10,2),               -- Day ADR $
  adr_mtd NUMERIC(10,2),               -- MTD ADR $
  adr_ytd NUMERIC(10,2),               -- YTD ADR $
  
  revpar_day NUMERIC(10,2),            -- Day RevPAR $
  revpar_mtd NUMERIC(10,2),            -- MTD RevPAR $
  revpar_ytd NUMERIC(10,2),            -- YTD RevPAR $
  
  -- Room Statistics
  total_rooms_sold INTEGER,            -- Rooms sold (day)
  total_rooms_available INTEGER,       -- Total inventory (for context)
  ooo_rooms INTEGER DEFAULT 0,         -- Out of Order / Out of Service
  
  -- Revenue
  revenue_day NUMERIC(12,2),           -- Day room revenue $
  revenue_mtd NUMERIC(12,2),           -- MTD room revenue $
  revenue_ytd NUMERIC(12,2),           -- YTD room revenue $
  
  -- Prior Year Comparison
  py_revenue_day NUMERIC(12,2),        -- PY same-day revenue $
  py_revenue_mtd NUMERIC(12,2),        -- PY MTD revenue $
  py_revenue_ytd NUMERIC(12,2),        -- PY YTD revenue $
  
  -- Metadata
  report_format TEXT,                  -- Source report type for traceability
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(property_name, report_date)
);

-- Index for fast dashboard queries
CREATE INDEX idx_dhp_date ON daily_hotel_performance(report_date DESC);
CREATE INDEX idx_dhp_property_date ON daily_hotel_performance(property_name, report_date DESC);
```

## View Requirements

### Layout: Single-Page Dashboard

**Header Bar**
- Title: "Stoneriver HG — Daily Performance"
- Date picker defaulting to yesterday's date (most recent report date)
- Toggle between "Day" | "MTD" | "YTD" view modes
- Small pill showing total portfolio rooms sold and total portfolio revenue for selected period

**Main Table — Property Performance Grid**

Display all 21 properties in a table with the following columns. The columns shown should respond to the Day/MTD/YTD toggle:

| Column | Format | Notes |
|--------|--------|-------|
| Property | Text, left-aligned | Truncate long names, show full on hover |
| Group | Small muted label | e.g. "Hilton", "IHG", "Marriott" |
| Occ % | Percentage, 1 decimal | Color-code: green ≥ 70%, yellow 50–69%, red < 50% |
| ADR | Currency, no cents | Right-aligned |
| RevPAR | Currency, no cents | Right-aligned |
| Rooms Sold | Integer | Right-aligned |
| OOO | Integer | Show in red if > 0 |
| Revenue | Currency | Right-aligned |
| PY Revenue | Currency, muted text | Right-aligned |
| Rev Δ % | Percentage | YoY change: (Revenue - PY Revenue) / PY Revenue. Green if positive, red if negative. Show "—" if PY data unavailable |

**Sorting:** Default sort by Revenue descending. All columns sortable on click.

**Row Grouping (optional toggle):** Allow grouping rows by `property_group` with subtotals per group. When grouped, show a thin section header row with the group name and aggregated totals.

**Portfolio Totals Row:** Sticky bottom row showing portfolio-wide totals/weighted averages:
- Occupancy: weighted average by available rooms
- ADR: Total Revenue / Total Rooms Sold
- RevPAR: Total Revenue / Total Available Rooms
- All other columns: simple sums

### Secondary Panel — Trend Sparklines (below main table)

For each property, show a small inline sparkline (last 30 days) for:
- Occupancy %
- RevPAR
- Revenue

These can be simple SVG line charts, no axes needed. Just enough to show directional trend. Render these in a compact card grid (3–4 properties per row).

### Data States

- **Missing report:** If a property has no data for the selected date, show the row grayed out with "No report" in the revenue column.
- **Partial data:** If PY revenue is null (Best Western, Hyatt, Four Points), show "—" in PY and Δ columns. Never show $0 for missing data.
- **Loading:** Skeleton rows matching table structure.
- **Empty state:** "No data for [selected date]. Reports typically arrive by 7:00 AM CT."

### Interactions

- **Click a property row** → Expand inline to show a mini detail card with all available metrics (Day + MTD + YTD side by side) regardless of current toggle, plus the last 7 days in a mini table.
- **Export button** → Download current view as CSV with all columns and the selected date range.

## Design Specifications

- **Font:** System font stack (Inter if available)
- **Colors:** 
  - Background: white
  - Text: `#1a1a1a` primary, `#6b7280` secondary/muted
  - Borders: `#e5e5e5` at 0.5px
  - Positive delta: `#16a34a`
  - Negative delta: `#dc2626`
  - Warning/OOO: `#dc2626`
  - Occupancy green: `#16a34a`, yellow: `#ca8a04`, red: `#dc2626`
  - Header background: `#fafafa`
  - Selected/hover row: `#f5f5f5`
- **Spacing:** Compact — 8px vertical padding per row, 12px horizontal cell padding
- **No shadows, no rounded corners on the table.** Flat, editorial, dense.
- **Numbers must be tabular-ligned** (use `font-variant-numeric: tabular-nums`)

## File Structure

```
src/
  components/
    DailyPerformanceDashboard.jsx    -- Main dashboard container
    PerformanceTable.jsx              -- The core data table
    PerformanceTableRow.jsx           -- Individual property row + expandable detail
    PortfolioTotalsRow.jsx            -- Sticky totals footer
    PropertySparklines.jsx            -- 30-day trend sparkline cards
    DatePicker.jsx                    -- Date selector
    PeriodToggle.jsx                  -- Day/MTD/YTD toggle
    ExportButton.jsx                  -- CSV export
  hooks/
    usePerformanceData.js             -- Supabase query hook for selected date
    useSparklineData.js               -- Supabase query hook for 30-day trends
  utils/
    formatters.js                     -- Currency, percentage, delta formatting
    calculations.js                   -- Portfolio weighted averages, YoY delta
  constants/
    properties.js                     -- Property list with groups, sort order
```

## Property Master List

Hardcode this as the canonical property list. The table should always show all 21 rows even if data is missing for some.

```js
export const PROPERTIES = [
  { name: "HGI Olive Branch", group: "Hilton", state: "MS" },
  { name: "Tru By Hilton Tupelo", group: "Hilton", state: "MS" },
  { name: "Hampton Inn Vicksburg", group: "Hilton", state: "MS" },
  { name: "DoubleTree Biloxi", group: "Hilton", state: "MS" },
  { name: "Home2 Suites By Hilton", group: "Hilton Extended", state: "MS" },
  { name: "Hilton Garden Inn Madison", group: "Hilton Extended", state: "MS" },
  { name: "Hilton Garden Inn Meridian", group: "Hilton Extended", state: "MS" },
  { name: "Hampton Inn Meridian", group: "Hilton Extended", state: "MS" },
  { name: "Holiday Inn Meridian", group: "IHG", state: "MS" },
  { name: "Candlewood Suites", group: "IHG", state: "MS" },
  { name: "Holiday Inn Express Fulton", group: "IHG", state: "MS" },
  { name: "Holiday Inn Express Memphis Southwind", group: "IHG", state: "TN" },
  { name: "Holiday Inn Express Tupelo", group: "IHG", state: "MS" },
  { name: "Holiday Inn Tupelo", group: "IHG", state: "MS" },
  { name: "Four Points Memphis Southwind", group: "Marriott", state: "TN" },
  { name: "TownePlace Suites", group: "Marriott", state: "MS" },
  { name: "Best Western Tupelo", group: "Best Western", state: "MS" },
  { name: "SureStay Hotel", group: "Best Western", state: "MS" },
  { name: "Best Western Plus Olive Branch", group: "Best Western", state: "MS" },
  { name: "Hyatt Place Biloxi", group: "Hyatt", state: "MS" },
  { name: "Comfort Inn Tupelo", group: "Choice", state: "MS" },
];
```

## Supabase Query Pattern

```js
// Primary query — single date
const { data, error } = await supabase
  .from('daily_hotel_performance')
  .select('*')
  .eq('report_date', selectedDate)
  .order('revenue_day', { ascending: false });

// Sparkline query — last 30 days
const { data: trends } = await supabase
  .from('daily_hotel_performance')
  .select('property_name, report_date, occupancy_day, revpar_day, revenue_day')
  .gte('report_date', thirtyDaysAgo)
  .lte('report_date', selectedDate)
  .order('report_date', { ascending: true });
```

## Important Notes

1. **RevPAR may be calculated or direct** depending on the property group. By the time data hits this table, RevPAR should always be populated (the extraction pipeline handles the calculation). The view just reads what's there.

2. **PY Revenue will be null for some properties** (Best Western group, Hyatt Place, Four Points) because their report formats don't include it inline. The view must handle nulls gracefully — never show $0, always show "—".

3. **DoubleTree Biloxi appears in two extraction groups** (Hilton Standard and Hilton Extended). The database will have one row per property per date. The extraction pipeline resolves which format to use. The view doesn't need to worry about this — just display what's in the table.

4. **This is a morning ritual view.** It needs to load fast, be scannable in 10 seconds, and immediately surface which properties outperformed or underperformed. Optimize for information density and quick pattern recognition over aesthetics.

5. **Mobile consideration:** This will primarily be used on desktop/tablet, but should not break on mobile. On narrow screens, hide the sparklines panel and reduce the table to: Property, Occ%, Revenue, Rev Δ%.
