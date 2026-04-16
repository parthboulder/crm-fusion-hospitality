/**
 * Shared TypeScript types for the API — augments Fastify's request/reply types.
 */

import type { Permission, SystemRole } from '../config/constants.js';

// ─── Auth Context ──────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  orgId: string;
  email: string;
  fullName: string;
  roleId: string;
  roleName: SystemRole;
  sessionId: string;
  permissions: Permission[];
  propertyIds: string[]; // which properties this user can access
}

// ─── Fastify Augmentation ────────────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser;
    requestId: string;
  }
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─── API Responses ────────────────────────────────────────────────────────────

export interface ApiSuccess<T = unknown> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ─── File Upload ──────────────────────────────────────────────────────────────

export interface UploadedFile {
  filename: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

// ─── Extraction ───────────────────────────────────────────────────────────────

export interface ExtractionResult {
  reportType: string;
  reportDate: string;
  propertyName: string;
  confidenceScore: number;
  requiresReview: boolean;
  extractionNotes: string;
  metrics: Partial<DailyMetricsPayload>;
  financials: Partial<FinancialMetricsPayload>;
  operationalFlags: OperationalFlag[];
}

export interface DailyMetricsPayload {
  totalRooms: number;
  roomsSold: number;
  roomsOoo: number;
  roomsComplimentary: number;
  occupancyPct: number;
  adr: number;
  revpar: number;
  totalRevenue: number;
  roomRevenue: number;
  fbRevenue: number;
  otherRevenue: number;
  pyTotalRevenue: number;
  pyRoomRevenue: number;
  pyOccupancyPct: number;
  pyAdr: number;
  pyRevpar: number;
  budgetOccupancyPct: number;
  budgetAdr: number;
  budgetRevpar: number;
  budgetTotalRevenue: number;
  forecastOccupancyPct: number;
  forecastRevenue: number;
}

export interface FinancialMetricsPayload {
  arCurrent: number;
  ar30Days: number;
  ar60Days: number;
  ar90Days: number;
  ar90PlusDays: number;
  arTotal: number;
  ccVisa: number;
  ccMastercard: number;
  ccAmex: number;
  ccDiscover: number;
  ccOther: number;
  ccTotal: number;
  ccDisputes: number;
  cashSales: number;
  cashDeposits: number;
  cashVariance: number;
  adjustmentsTotal: number;
  voidsTotal: number;
  compsTotal: number;
  discountsTotal: number;
  taxCollected: number;
  taxExemptTotal: number;
  guestLedgerBalance: number;
  advanceDeposits: number;
}

export interface OperationalFlag {
  type: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}
