# Stoneriver HG — Hotel Report Data Extraction Guide

> **Purpose:** Standard reference for extracting daily hotel performance metrics from each property's nightly report. Each property group uses a different PMS/report format. This guide maps the universal KPIs to the exact row/page location in each report type.

---

## Universal KPIs to Extract

| KPI | Description |
|-----|-------------|
| **Occupancy %** | Percentage of available rooms sold |
| **ADR** | Average Daily Rate |
| **RevPAR** | Revenue Per Available Room |
| **Total Rooms (Sold)** | Number of rooms sold |
| **Revenue** | Total room revenue |
| **PY Revenue** | Previous year total room revenue (same date) |
| **OOO Rooms** | Out of Order / Out of Service rooms |

---

## Group 1 — Hilton Hotel Statistics PDF

### Properties
1. HGI Olive Branch
2. Tru By Hilton — Tupelo, MS
3. Hampton Inn Vicksburg
4. DoubleTree Biloxi

### Extraction Map

| KPI | Report Location |
|-----|-----------------|
| **Occupancy %** | Page 1 → Performance Statistics → Occupancy % |
| **ADR** | Page 1 → Performance Statistics → ADR |
| **RevPAR** | Page 1 → Performance Statistics → REVPAR |
| **Total Rooms** | Page 1 → Room Statistics → Total Rooms |
| **Revenue** | Page 1 → Revenue Statistics → Total Room Revenue |
| **PY Revenue** | Page 1 → Revenue Statistics (Same Date Last Year) → Total Room Revenue |
| **OOO Rooms** | Page 1 → Room Statistics → OOO Rooms |

---

## Group 2 — Hilton Hotel Statistics PDF (Extended Format)

### Properties
1. Home2 Suites By Hilton
2. DoubleTree Biloxi
3. Hilton Garden Inn Madison
4. Hilton Garden Inn Meridian
5. Hampton Inn Meridian
6. Holiday Inn Meridian

### Extraction Map

| KPI | Report Location |
|-----|-----------------|
| **Occupancy %** | Page 1 → Performance Statistics → Occupancy Including Down, Comp, House Use Rooms % |
| **ADR** | Page 2 → Revenue Performance → ADR Including Comp, House Use Rooms |
| **RevPAR** | Page 2 → Revenue Performance → REVPAR |
| **Total Rooms** | Page 1 → Room Statistics → Total Rooms |
| **Revenue** | Page 2 → Revenue Statistics → Totals |
| **PY Revenue** | Page 2 → Revenue Statistics (Same Date Last Year) → Total |
| **OOO Rooms** | Page 1 → Room Statistics → OOO Rooms |

### Notes
- This group uses occupancy **including** down, comp, and house use rooms.
- ADR also **includes** comp and house use rooms.
- Revenue and ADR data are on **Page 2**, not Page 1.

---

## Group 3 — IHG Manager Flash Report

### Properties
1. Candlewood Suites
2. Holiday Inn Express Fulton
3. Holiday Inn Express Memphis Southwind
4. Holiday Inn Express Tupelo
5. Holiday Inn Tupelo

### Extraction Map

| KPI | Report Location | Data Format |
|-----|-----------------|-------------|
| **Occupancy %** | Page 1 → % Rooms Occupied | Day, MTD, YTD |
| **ADR** | Page 1 → ADR row | Day, MTD, YTD |
| **RevPAR** | **Calculated:** Occupancy × ADR | Day, MTD, YTD |
| **Total Rooms** | Page 1 → Rooms Occupied | — |
| **Revenue** | Page 1 → Room Revenue | Day, MTD, YTD |
| **PY Revenue** | Page 1 → Room Revenue (LY columns) | Day, MTD, YTD |
| **OOO Rooms** | Page 1 → Out of Order Rooms | — |

### Notes
- **RevPAR is not directly reported** — must be calculated as Occupancy % × ADR.
- Revenue row follows Day / MTD / YTD / LY structure.

---

## Group 4 — Marriott Manager Statistics Report

### Properties
1. Four Points Memphis Southwind

### Extraction Map

| KPI | Report Location |
|-----|-----------------|
| **Occupancy %** | Page 1 → Occupancy % Less Comp |
| **ADR** | Page 1 → Net Avg. Rate (Less Comp) |
| **RevPAR** | **Calculated:** Occupancy × ADR |
| **Total Rooms** | Page 1 → Rooms Occupied |
| **Revenue** | Page 1 → Room Revenue |
| **PY Revenue** | Same report, same date, previous year file |
| **OOO Rooms** | Page 1 → Out of Order Rooms |

### Notes
- Uses **"Less Comp"** variants for both Occupancy and ADR.
- **PY Revenue requires pulling the same report from last year's date** — not embedded in the current report.
- **RevPAR is calculated**, not directly reported.

---

## Group 5 — Best Western Daily Report (Statistical Recap)

### Properties
1. Best Western Tupelo
2. SureStay Hotel
3. Best Western Plus Olive Branch

### Extraction Map

| KPI | Report Location |
|-----|-----------------|
| **Occupancy %** | Page 1 → Statistical Recap → Occupancy % |
| **ADR** | Page 1 → Statistical Recap → Gross Avg. Rate |
| **RevPAR** | **Calculated:** Occupancy × ADR |
| **Total Rooms** | Page 1 → Statistical Recap → Rooms Occupied |
| **Revenue** | Page 1 → Statistical Recap → Room Revenue |
| **PY Revenue** | — *(not specified; may require separate report)* |
| **OOO Rooms** | Page 1 → Statistical Recap → Out of Service |

### Notes
- Uses **"Gross Avg. Rate"** for ADR (not net).
- OOO is labeled **"Out of Service"** in this report format.
- **RevPAR is calculated**, not directly reported.

---

## Group 6 — Hyatt Manager Flash Report

### Properties
1. Hyatt Place Biloxi

### Extraction Map

| KPI | Report Location |
|-----|-----------------|
| **Occupancy %** | Page 1 → % Rooms Occupied |
| **ADR** | Page 2 → ADR |
| **RevPAR** | **Calculated:** Occupancy × ADR |
| **Total Rooms** | Page 1 → Rooms Occupied |
| **Revenue** | Page 2 → Room Revenue |
| **PY Revenue** | Same report from 2025 (previous year file) |
| **OOO Rooms** | Page 1 → Out of Service |

### Notes
- Data is **split across two pages**: occupancy/rooms on Page 1, revenue/ADR on Page 2.
- OOO is labeled **"Out of Service"**.
- **PY Revenue requires the 2025 version** of the same report.
- **RevPAR is calculated**, not directly reported.

---

## Group 7 — Marriott Revenue Report

### Properties
1. TownePlace Suites

### Extraction Map

| KPI | Report Location | Data Format |
|-----|-----------------|-------------|
| **Occupancy %** | Page 1 → % Occupancy PCT | Day, MTD, YTD |
| **ADR** | Page 1 → AVG RATE PER ROOM | Day, MTD, YTD |
| **RevPAR** | Page 1 → REVPAR | Day, MTD, YTD |
| **Total Rooms** | Page 1 → Rooms Occupied | — |
| **Revenue** | Page 1 → TOTAL ROOM SALES | Day, MTD, YTD |
| **PY Revenue** | Page 1 → TOTAL ROOM SALES (LY columns) | Day, MTD, YTD |
| **OOO Rooms** | Page 1 → Out of Order | — |

### Notes
- **RevPAR is directly reported** in this format (row labeled REVPAR).
- Revenue follows Day / MTD / YTD / LY structure.
- All data is on **Page 1**.

---

## Group 8 — Choice Hotels Statistics Report

### Properties
1. Comfort Inn Tupelo

### Extraction Map

| KPI | Report Location | Data Format |
|-----|-----------------|-------------|
| **Occupancy %** | Page 1 → Occ% of Total Available Rooms | Day, MTD, YTD |
| **ADR** | Page 1 → ADR for Total Rev Rooms | Day, MTD, YTD |
| **RevPAR** | Page 1 → RevPar | Day, MTD, YTD |
| **Total Rooms** | Page 1 → Total Occupied Rooms | — |
| **Revenue** | Page 1 → Total Room Revenue | Day, MTD, YTD |
| **PY Revenue** | Page 1 → Total Room Revenue (LY columns) | Day, MTD, YTD |
| **OOO Rooms** | Page 1 → Out Of Order | — |

### Notes
- **RevPAR is directly reported** (row labeled RevPar).
- Revenue follows Day / MTD / YTD / LY structure.
- All data is on **Page 1**.

---

## Quick Reference: Calculation Requirements

| Group | RevPAR | PY Revenue |
|-------|--------|------------|
| 1 — Hilton (Standard) | Direct from report | Direct from report |
| 2 — Hilton (Extended) | Direct from report | Direct from report |
| 3 — IHG Flash | **Calculate:** Occ × ADR | LY columns in report |
| 4 — Marriott (Four Points) | **Calculate:** Occ × ADR | **Separate prior-year report** |
| 5 — Best Western | **Calculate:** Occ × ADR | *Not specified* |
| 6 — Hyatt | **Calculate:** Occ × ADR | **Separate prior-year report (2025)** |
| 7 — Marriott (TownePlace) | Direct from report | LY columns in report |
| 8 — Choice (Comfort Inn) | Direct from report | LY columns in report |

---

## Quick Reference: OOO Label Variations

| Report Format | OOO Label |
|---------------|-----------|
| Hilton (Groups 1 & 2) | OOO Rooms |
| IHG Flash (Group 3) | Out of Order Rooms |
| Marriott Statistics (Group 4) | Out of Order Rooms |
| Best Western (Group 5) | Out of Service |
| Hyatt Flash (Group 6) | Out of Service |
| Marriott Revenue (Group 7) | Out of Order |
| Choice Statistics (Group 8) | Out Of Order |

---

## Full Property Index

| # | Property | Group | Report Type |
|---|----------|-------|-------------|
| 1 | HGI Olive Branch | 1 | Hilton Hotel Statistics PDF |
| 2 | Tru By Hilton — Tupelo | 1 | Hilton Hotel Statistics PDF |
| 3 | Hampton Inn Vicksburg | 1 | Hilton Hotel Statistics PDF |
| 4 | DoubleTree Biloxi | 1 / 2 | Hilton Hotel Statistics PDF |
| 5 | Home2 Suites By Hilton | 2 | Hilton Hotel Statistics PDF (Extended) |
| 6 | Hilton Garden Inn Madison | 2 | Hilton Hotel Statistics PDF (Extended) |
| 7 | Hilton Garden Inn Meridian | 2 | Hilton Hotel Statistics PDF (Extended) |
| 8 | Hampton Inn Meridian | 2 | Hilton Hotel Statistics PDF (Extended) |
| 9 | Holiday Inn Meridian | 2 | Hilton Hotel Statistics PDF (Extended) |
| 10 | Candlewood Suites | 3 | IHG Manager Flash Report |
| 11 | Holiday Inn Express Fulton | 3 | IHG Manager Flash Report |
| 12 | Holiday Inn Express Memphis Southwind | 3 | IHG Manager Flash Report |
| 13 | Holiday Inn Express Tupelo | 3 | IHG Manager Flash Report |
| 14 | Holiday Inn Tupelo | 3 | IHG Manager Flash Report |
| 15 | Four Points Memphis Southwind | 4 | Marriott Manager Statistics Report |
| 16 | Best Western Tupelo | 5 | Best Western Daily Report |
| 17 | SureStay Hotel | 5 | Best Western Daily Report |
| 18 | Best Western Plus Olive Branch | 5 | Best Western Daily Report |
| 19 | Hyatt Place Biloxi | 6 | Hyatt Manager Flash Report |
| 20 | TownePlace Suites | 7 | Marriott Revenue Report |
| 21 | Comfort Inn Tupelo | 8 | Choice Hotels Statistics Report |

> **Note:** DoubleTree Biloxi appears in both Group 1 and Group 2. Confirm which extraction logic applies based on the specific report received for that property.
