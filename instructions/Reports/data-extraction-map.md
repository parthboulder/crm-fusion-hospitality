# Data Extraction Map — Hotel Daily Reports

> **Purpose:** Map specific data fields to the report where they should be extracted from. This is not generic advice — it is a practical field-by-field extraction guide for the Stoneriver HG portfolio.

---

## Revenue Flash Spreadsheet

**Priority:** CRITICAL
**Primary Purpose:** Daily revenue snapshot with occupancy, ADR, RevPAR, and year-over-year comparisons
**Typical Format:** Excel (.xlsx)

| Field | Description | Use Case | Priority |
|-------|-------------|----------|----------|
| occupancy_pct (day/MTD/YTD) | Percentage of available rooms sold | Flash reporting | Critical |
| adr (day/MTD/YTD) | Average Daily Rate | Flash reporting | Critical |
| revpar (day/MTD/YTD) | Revenue Per Available Room | Flash reporting | Critical |
| rooms_sold | Total rooms sold for the day | Operations | Critical |
| room_revenue (day/MTD/YTD) | Total room revenue | Flash reporting | Critical |
| ooo_rooms | Out-of-order room count | Operations | High |
| py_revenue (day/MTD/YTD) | Prior year revenue for same period | Executive | High |
| py_occupancy | Prior year occupancy comparison | Executive | High |
| py_adr | Prior year ADR comparison | Executive | Medium |
| budget_variance | Budget vs actual variance | Executive | Medium |
| forecast_occupancy | Forecast occupancy for upcoming days | Operations | Medium |
| total_revenue | Total property revenue (all departments) | Executive | Low (v2) |
| fb_revenue | F&B revenue if present | Executive | Low (v2) |

**Why these fields matter:** This is the single most important report for daily executive oversight. Occupancy, ADR, and RevPAR are the three pillars of hotel revenue management. Year-over-year comparison shows performance trends. Budget variance flags underperformance immediately.

---

## Daily Report Statistical Recap (Best Western format)

**Priority:** CRITICAL
**Primary Purpose:** High-level daily operating KPIs with business mix and segmentation
**Typical Format:** PDF

| Field | Description | Use Case | Priority |
|-------|-------------|----------|----------|
| occupancy_pct | Occupancy percentage | Flash reporting | Critical |
| adr (Gross Avg. Rate) | Average Daily Rate | Flash reporting | Critical |
| revpar | Calculated: Occ% x ADR | Flash reporting | Critical |
| rooms_sold | Rooms occupied count | Operations | Critical |
| room_revenue | Total room revenue | Flash reporting | Critical |
| business_mix | Transient/group/contract breakdown | Operations | High |
| comp_rooms | Complimentary room count | Controls | Medium |
| house_use_rooms | House use room count | Controls | Medium |
| ooo_rooms (labeled "Out of Service") | Out-of-service count | Operations | High |
| no_shows | No-show count for the day | Operations | Low |

**Brand note:** Best Western uses "Gross Avg. Rate" for ADR (not net). OOO is labeled "Out of Service" in this format. RevPAR must be calculated — it is not directly reported.

---

## Hotel Statistics Report (Hilton Standard & Extended)

**Priority:** CRITICAL
**Primary Purpose:** Comprehensive daily statistics with performance and revenue data
**Typical Format:** PDF (multi-page)

### Standard Format (Group 1: HGI OB, Tru Tupelo, Hampton Vicksburg, DoubleTree Biloxi)

| Field | Report Location | Priority |
|-------|----------------|----------|
| occupancy_pct | Page 1 → Performance Statistics → Occupancy % | Critical |
| adr | Page 1 → Performance Statistics → ADR | Critical |
| revpar | Page 1 → Performance Statistics → REVPAR | Critical |
| total_rooms | Page 1 → Room Statistics → Total Rooms | High |
| room_revenue | Page 1 → Revenue Statistics → Total Room Revenue | Critical |
| py_room_revenue | Page 1 → Revenue Statistics (STLY) → Total Room Revenue | High |
| ooo_rooms | Page 1 → Room Statistics → OOO Rooms | High |

### Extended Format (Group 2: Home2, HGI Madison, HGI Meridian, Hampton Meridian)

| Field | Report Location | Priority |
|-------|----------------|----------|
| occupancy_pct | Page 1 → Occupancy Including Down, Comp, House Use % | Critical |
| adr | **Page 2** → ADR Including Comp, House Use | Critical |
| revpar | **Page 2** → REVPAR | Critical |
| total_rooms | Page 1 → Room Statistics → Total Rooms | High |
| room_revenue | **Page 2** → Revenue Statistics → Totals | Critical |
| py_room_revenue | **Page 2** → Revenue Statistics (STLY) → Total | High |
| ooo_rooms | Page 1 → Room Statistics → OOO Rooms | High |

**Key difference:** Extended format has revenue/ADR data on Page 2, not Page 1. Uses occupancy _including_ down, comp, and house use rooms.

---

## IHG Manager Flash Report

**Priority:** CRITICAL
**Primary Purpose:** IHG brand manager summary with day/MTD/YTD performance
**Properties:** Candlewood, HIE Fulton, HIE Memphis, HIE Tupelo, HI Tupelo, HI Meridian
**Typical Format:** PDF

| Field | Report Location | Data Format | Priority |
|-------|----------------|-------------|----------|
| occupancy_pct | Page 1 → % Rooms Occupied | Day/MTD/YTD | Critical |
| adr | Page 1 → ADR row | Day/MTD/YTD | Critical |
| revpar | **Calculated:** Occ% × ADR | Day/MTD/YTD | Critical |
| rooms_sold | Page 1 → Rooms Occupied | Day only | Critical |
| room_revenue | Page 1 → Room Revenue | Day/MTD/YTD | Critical |
| py_revenue | Page 1 → Room Revenue (LY columns) | Day/MTD/YTD | High |
| ooo_rooms | Page 1 → Out of Order Rooms | Day only | High |

**Critical note:** RevPAR is NOT directly reported in IHG format — must be calculated as `occupancy_pct × adr / 100`.

---

## Marriott Manager Statistics Report (Four Points)

**Priority:** CRITICAL
**Typical Format:** PDF

| Field | Report Location | Priority |
|-------|----------------|----------|
| occupancy_pct | Page 1 → Occupancy % Less Comp | Critical |
| adr | Page 1 → Net Avg. Rate (Less Comp) | Critical |
| revpar | **Calculated:** Occ% × ADR | Critical |
| rooms_sold | Page 1 → Rooms Occupied | Critical |
| room_revenue | Page 1 → Room Revenue | Critical |
| py_revenue | **Requires separate prior-year file** | High |
| ooo_rooms | Page 1 → Out of Order Rooms | High |

**Critical note:** Uses "Less Comp" variants. PY Revenue is NOT in the current report — it requires pulling the same report from last year's date.

---

## Marriott Revenue Report (TownePlace Suites)

**Priority:** CRITICAL
**Typical Format:** PDF

| Field | Report Location | Data Format | Priority |
|-------|----------------|-------------|----------|
| occupancy_pct | Page 1 → % Occupancy PCT | Day/MTD/YTD | Critical |
| adr | Page 1 → AVG RATE PER ROOM | Day/MTD/YTD | Critical |
| revpar | Page 1 → REVPAR | Day/MTD/YTD | Critical |
| total_room_sales | Page 1 → TOTAL ROOM SALES | Day/MTD/YTD | Critical |
| py_room_sales | Page 1 → TOTAL ROOM SALES (LY columns) | Day/MTD/YTD | High |
| ooo_rooms | Page 1 → Out of Order | High |

**Note:** RevPAR IS directly reported in this format. All data on Page 1.

---

## Hyatt Manager Flash Report

**Priority:** CRITICAL
**Typical Format:** PDF (2-page)

| Field | Report Location | Priority |
|-------|----------------|----------|
| occupancy_pct | **Page 1** → % Rooms Occupied | Critical |
| adr | **Page 2** → ADR | Critical |
| revpar | **Calculated:** Occ% × ADR | Critical |
| rooms_sold | **Page 1** → Rooms Occupied | Critical |
| room_revenue | **Page 2** → Room Revenue | Critical |
| py_revenue | **Requires 2025 version of same report** | High |
| ooo_rooms | **Page 1** → Out of Service | High |

**Critical note:** Data split across two pages. OOO labeled "Out of Service." PY Revenue requires prior-year file.

---

## Choice Hotels Statistics Report (Comfort Inn Tupelo)

**Priority:** CRITICAL
**Typical Format:** PDF

| Field | Report Location | Data Format | Priority |
|-------|----------------|-------------|----------|
| occupancy_pct | Page 1 → Occ% of Total Available Rooms | Day/MTD/YTD | Critical |
| adr | Page 1 → ADR for Total Rev Rooms | Day/MTD/YTD | Critical |
| revpar | Page 1 → RevPar | Day/MTD/YTD | Critical |
| rooms_sold | Page 1 → Total Occupied Rooms | Day only | Critical |
| room_revenue | Page 1 → Total Room Revenue | Day/MTD/YTD | Critical |
| py_revenue | Page 1 → Total Room Revenue (LY columns) | Day/MTD/YTD | High |
| ooo_rooms | Page 1 → Out Of Order | High |

**Note:** RevPAR IS directly reported. All data on Page 1.

---

## Aging Report

**Priority:** HIGH
**Primary Purpose:** Accounts receivable aging buckets for collections follow-up
**Typical Format:** PDF

| Field | Description | Use Case | Priority |
|-------|-------------|----------|----------|
| ar_current | Current (0-30 days) balance | Accounting | Critical |
| ar_30_days | 31-60 day balance | Accounting | Critical |
| ar_60_days | 61-90 day balance | Accounting | Critical |
| ar_90_plus_days | 90+ day balance | Accounting | Critical |
| ar_total | Total outstanding receivables | Executive | Critical |
| major_balances | Individual accounts over $1,000 | Controls | High |
| collection_notes | Notes on overdue accounts | Operations | Medium |

**Why it matters:** Overdue receivables directly impact cash flow. The 90+ bucket is the most actionable — these are the accounts needing immediate follow-up. Major individual balances may need escalation.

---

## Credit Card Transactions Report

**Priority:** HIGH
**Primary Purpose:** Card settlement totals for daily reconciliation
**Typical Format:** PDF

| Field | Description | Use Case | Priority |
|-------|-------------|----------|----------|
| cc_visa | Visa settlement total | Accounting | High |
| cc_mastercard | Mastercard settlement total | Accounting | High |
| cc_amex | Amex settlement total | Accounting | High |
| cc_discover | Discover settlement total | Accounting | High |
| cc_other | Other cards total | Accounting | Medium |
| cc_total | Total card settlements | Controls | Critical |
| cc_disputes | Dispute/chargeback amounts | Controls | High |
| settlement_date | Batch settlement date | Accounting | Medium |

**Why it matters:** Card settlements must match PMS totals. Discrepancies indicate processing errors, chargebacks, or fraud. Dispute tracking prevents revenue leakage.

---

## Operator Transactions Report

**Priority:** HIGH
**Primary Purpose:** Audit trail for adjustments, comps, refunds, and corrections
**Typical Format:** PDF

| Field | Description | Use Case | Priority |
|-------|-------------|----------|----------|
| adjustments_total | Total adjustment amount | Controls | Critical |
| comps_total | Total complimentary charges | Controls | Critical |
| voids_total | Total voids amount | Controls | Critical |
| refunds_total | Total refunds | Controls | High |
| paid_outs | Total paid-out amounts | Controls | High |
| operator_detail | Breakdown by operator ID/name | Controls | Medium |
| unusual_transactions | High-value or off-hours transactions | Controls | High |

**Why it matters:** This is the primary internal controls report. High adjustment, void, or comp totals relative to revenue indicate potential misuse. Operator-level detail enables accountability.

---

## Room & Tax Listing Report

**Priority:** HIGH
**Primary Purpose:** Room-level revenue and tax detail for rate validation
**Typical Format:** PDF

| Field | Description | Use Case | Priority |
|-------|-------------|----------|----------|
| total_room_revenue | Sum of all room charges | Accounting | Critical |
| total_tax_collected | Total taxes collected | Accounting | Critical |
| tax_exempt_amount | Tax-exempt room revenue | Controls | High |
| room_count | Number of rooms on listing | Operations | Medium |
| rate_anomalies | Rooms with unusually high/low rates | Controls | Medium |
| tax_rate_validation | Effective tax rate vs statutory rate | Controls | Low (v2) |

---

## OOO Rooms Report

**Priority:** HIGH
**Primary Purpose:** Out-of-order room tracking and maintenance impact assessment
**Typical Format:** Excel (.xlsx) or PDF

| Field | Description | Use Case | Priority |
|-------|-------------|----------|----------|
| ooo_count | Total OOO/OOS room count | Operations | Critical |
| room_numbers | Specific room numbers affected | Operations | High |
| reason_codes | Reason (maintenance, renovation, damage) | Operations | High |
| expected_return | Expected return-to-service dates | Operations | Medium |
| sellable_impact | Lost sellable inventory count | Flash reporting | High |

**Why it matters:** OOO rooms directly reduce sellable inventory, which impacts occupancy, RevPAR, and revenue. Tracking expected return dates helps revenue management forecast availability.

---

## Daily Transaction Log Report

**Priority:** MEDIUM
**Primary Purpose:** Detailed audit trail for exception investigation
**Typical Format:** PDF

| Field | Description | Use Case | Priority |
|-------|-------------|----------|----------|
| total_transactions | Transaction count | Operations | Medium |
| exception_flags | Unusual or flagged transactions | Controls | High |
| late_checkouts | Late checkout charges | Operations | Low |
| misc_charges | Miscellaneous charges total | Accounting | Low |

**Why it matters:** This is a supporting audit document. Not typically extracted in v1 unless specific exception investigation is needed. The primary value is as a reference document for controls audits.

---

## Extraction Priority Summary

| Priority | Report Types | Action |
|----------|-------------|--------|
| **Critical** | Revenue Flash, Statistical Recap, Hotel Statistics, Manager Flash, Marriott Stats/Revenue, Choice Stats | Extract immediately, populate dashboard |
| **High** | Aging Report, CC Transactions, Room & Tax, Operator Transactions, OOO Rooms | Extract and store, populate financial/operational tables |
| **Medium** | Daily Transaction Log | Store for reference, extract on demand |
| **Low** | Supporting/supplementary files | Store only, no extraction needed |

---

## Fields NOT Worth Extracting in v1

These fields exist in reports but provide low value relative to extraction effort:

- Individual guest names from transaction logs (PII concern, low operational value)
- Room-by-room rate detail from Room & Tax (too granular for daily management)
- Individual CC transaction line items (summary totals are sufficient)
- Detailed tax line items by jurisdiction (aggregate is enough)
- Timestamp of each transaction in daily log (audit reference only)
- Operator shift start/end times (operational but not management-relevant)
