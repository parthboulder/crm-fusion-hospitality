/**
 * Shared TypeScript types for the Stoneriver daily performance dashboard.
 */

export type Period = 'day' | 'mtd' | 'ytd';

export type SortCol =
  | 'property_name'
  | 'occupancy'
  | 'adr'
  | 'revpar'
  | 'total_rooms_sold'
  | 'ooo_rooms'
  | 'revenue'
  | 'py_revenue'
  | 'rev_delta';

export interface DailyHotelPerformance {
  id: string;
  property_name: string;
  property_group: string;
  report_date: string;

  occupancy_day: number | null;
  occupancy_mtd: number | null;
  occupancy_ytd: number | null;

  adr_day: number | null;
  adr_mtd: number | null;
  adr_ytd: number | null;

  revpar_day: number | null;
  revpar_mtd: number | null;
  revpar_ytd: number | null;

  total_rooms_sold: number | null;
  total_rooms_available: number | null;
  ooo_rooms: number | null;

  revenue_day: number | null;
  revenue_mtd: number | null;
  revenue_ytd: number | null;

  py_revenue_day: number | null;
  py_revenue_mtd: number | null;
  py_revenue_ytd: number | null;

  report_format: string | null;
  extracted_at: string;
  created_at: string;
}

export interface SparklinePoint {
  property_name: string;
  report_date: string;
  occupancy_day: number | null;
  revpar_day: number | null;
  revenue_day: number | null;
}

/** Helpers to pull period-specific values from a row */
export function getOcc(row: DailyHotelPerformance, period: Period): number | null {
  return period === 'day' ? row.occupancy_day : period === 'mtd' ? row.occupancy_mtd : row.occupancy_ytd;
}

export function getAdr(row: DailyHotelPerformance, period: Period): number | null {
  return period === 'day' ? row.adr_day : period === 'mtd' ? row.adr_mtd : row.adr_ytd;
}

export function getRevpar(row: DailyHotelPerformance, period: Period): number | null {
  return period === 'day' ? row.revpar_day : period === 'mtd' ? row.revpar_mtd : row.revpar_ytd;
}

export function getRevenue(row: DailyHotelPerformance, period: Period): number | null {
  return period === 'day' ? row.revenue_day : period === 'mtd' ? row.revenue_mtd : row.revenue_ytd;
}

export function getPyRevenue(row: DailyHotelPerformance, period: Period): number | null {
  return period === 'day' ? row.py_revenue_day : period === 'mtd' ? row.py_revenue_mtd : row.py_revenue_ytd;
}
