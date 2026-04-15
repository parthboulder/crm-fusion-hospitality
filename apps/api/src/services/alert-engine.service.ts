/**
 * Alert engine — evaluates metrics after extraction and creates Alert + Task records.
 * All thresholds are defined in constants.ts for single-source-of-truth.
 */

import { db } from '@fusion/db';
import { ALERT_THRESHOLDS, SEVERITY } from '../config/constants.js';
import type { DailyMetricsPayload, FinancialMetricsPayload } from '../types/index.js';

interface AlertCandidate {
  alertType: string;
  severity: string;
  title: string;
  description: string;
  metricName: string;
  metricValue?: number;
  thresholdValue?: number;
  priorValue?: number;
  pctChange?: number;
}

export class AlertEngineService {
  async evaluate(
    reportId: string,
    propertyId: string,
    orgId: string,
    metrics: Partial<DailyMetricsPayload>,
    financials: Partial<FinancialMetricsPayload>,
  ): Promise<void> {
    const property = await db.property.findUnique({ where: { id: propertyId } });
    if (!property) return;

    const alerts = [
      ...this.evaluatePerformanceMetrics(metrics, property),
      ...this.evaluateFinancialMetrics(financials, metrics),
    ];

    if (alerts.length === 0) return;

    // Bulk insert alerts + auto-create tasks for critical/high.
    for (const alert of alerts) {
      const created = await db.alert.create({
        data: {
          orgId,
          propertyId,
          reportId,
          alertType: alert.alertType,
          severity: alert.severity,
          title: alert.title,
          description: alert.description,
          metricName: alert.metricName,
          metricValue: alert.metricValue !== undefined ? String(alert.metricValue) : null,
          thresholdValue: alert.thresholdValue !== undefined ? String(alert.thresholdValue) : null,
          priorValue: alert.priorValue !== undefined ? String(alert.priorValue) : null,
          pctChange: alert.pctChange !== undefined ? String(alert.pctChange) : null,
          status: 'open',
        },
      });

      // Auto-create task for critical and high severity alerts.
      if (alert.severity === SEVERITY.CRITICAL || alert.severity === SEVERITY.HIGH) {
        await db.task.create({
          data: {
            orgId,
            propertyId,
            alertId: created.id,
            title: `Investigate: ${alert.title}`,
            description: alert.description,
            taskType: alert.alertType,
            priority: alert.severity,
            status: 'open',
          },
        });
      }
    }
  }

  // ─── Performance Metrics Evaluation ───────────────────────────────────────

  private evaluatePerformanceMetrics(
    metrics: Partial<DailyMetricsPayload>,
    property: { id: string; name: string; adrFloor: unknown },
  ) {
    const alerts: AlertCandidate[] = [];

    // Occupancy YoY drop.
    if (
      metrics.occupancyPct != null &&
      metrics.pyOccupancyPct != null &&
      metrics.pyOccupancyPct > 0
    ) {
      const drop = ((metrics.pyOccupancyPct - metrics.occupancyPct) / metrics.pyOccupancyPct) * 100;
      if (drop > ALERT_THRESHOLDS.OCCUPANCY_DROP_PCT) {
        alerts.push({
          alertType: 'occupancy_drop_yoy',
          severity: drop > 20 ? SEVERITY.CRITICAL : SEVERITY.HIGH,
          title: `Occupancy down ${drop.toFixed(1)}% YoY`,
          description: `Occupancy is ${metrics.occupancyPct.toFixed(1)}% vs ${metrics.pyOccupancyPct.toFixed(1)}% prior year — a ${drop.toFixed(1)}% decline.`,
          metricName: 'occupancy_pct',
          metricValue: metrics.occupancyPct,
          priorValue: metrics.pyOccupancyPct,
          pctChange: -drop,
          thresholdValue: ALERT_THRESHOLDS.OCCUPANCY_DROP_PCT,
        });
      }
    }

    // Revenue YoY drop.
    if (
      metrics.totalRevenue != null &&
      metrics.pyTotalRevenue != null &&
      metrics.pyTotalRevenue > 0
    ) {
      const drop = ((metrics.pyTotalRevenue - metrics.totalRevenue) / metrics.pyTotalRevenue) * 100;
      if (drop > ALERT_THRESHOLDS.REVENUE_DROP_PCT) {
        alerts.push({
          alertType: 'revenue_drop_yoy',
          severity: drop > 25 ? SEVERITY.CRITICAL : SEVERITY.HIGH,
          title: `Revenue down ${drop.toFixed(1)}% YoY`,
          description: `Total revenue is $${metrics.totalRevenue.toLocaleString()} vs $${metrics.pyTotalRevenue.toLocaleString()} prior year.`,
          metricName: 'total_revenue',
          metricValue: metrics.totalRevenue,
          priorValue: metrics.pyTotalRevenue,
          pctChange: -drop,
          thresholdValue: ALERT_THRESHOLDS.REVENUE_DROP_PCT,
        });
      }
    }

    // ADR below floor.
    const adrFloor = property.adrFloor ? Number(property.adrFloor) : null;
    if (metrics.adr != null && adrFloor != null) {
      const pctBelowFloor = ((adrFloor - metrics.adr) / adrFloor) * 100;
      if (pctBelowFloor > ALERT_THRESHOLDS.ADR_BELOW_FLOOR_PCT) {
        alerts.push({
          alertType: 'adr_below_floor',
          severity: SEVERITY.HIGH,
          title: `ADR $${metrics.adr.toFixed(2)} below floor $${adrFloor.toFixed(2)}`,
          description: `ADR is ${pctBelowFloor.toFixed(1)}% below the property floor rate.`,
          metricName: 'adr',
          metricValue: metrics.adr,
          thresholdValue: adrFloor,
          pctChange: -pctBelowFloor,
        });
      }
    }

    // High OOO rooms.
    if (metrics.roomsOoo != null && metrics.totalRooms != null && metrics.totalRooms > 0) {
      const oooPct = (metrics.roomsOoo / metrics.totalRooms) * 100;
      if (oooPct > ALERT_THRESHOLDS.OOO_ROOMS_HIGH_PCT) {
        alerts.push({
          alertType: 'high_ooo_rooms',
          severity: SEVERITY.MEDIUM,
          title: `${metrics.roomsOoo} rooms out of order (${oooPct.toFixed(1)}%)`,
          description: `${metrics.roomsOoo} of ${metrics.totalRooms} rooms are out of order, reducing sellable inventory.`,
          metricName: 'rooms_ooo',
          metricValue: metrics.roomsOoo,
          thresholdValue: ALERT_THRESHOLDS.OOO_ROOMS_HIGH_PCT,
          pctChange: oooPct,
        });
      }
    }

    return alerts;
  }

  // ─── Financial Metrics Evaluation ─────────────────────────────────────────

  private evaluateFinancialMetrics(
    financials: Partial<FinancialMetricsPayload>,
    metrics: Partial<DailyMetricsPayload>,
  ) {
    const alerts: AlertCandidate[] = [];

    // High AR aging (90+ days > 20% of total).
    if (financials.ar90PlusDays != null && financials.arTotal != null && financials.arTotal > 0) {
      const pct = (financials.ar90PlusDays / financials.arTotal) * 100;
      if (pct > ALERT_THRESHOLDS.AR_90_PLUS_THRESHOLD_PCT) {
        alerts.push({
          alertType: 'high_ar_aging',
          severity: pct > 35 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
          title: `AR aging: ${pct.toFixed(1)}% is 90+ days past due`,
          description: `$${financials.ar90PlusDays.toLocaleString()} of $${financials.arTotal.toLocaleString()} total AR is 90+ days old.`,
          metricName: 'ar_90_plus_days',
          metricValue: financials.ar90PlusDays,
          thresholdValue: ALERT_THRESHOLDS.AR_90_PLUS_THRESHOLD_PCT,
          pctChange: pct,
        });
      }
    }

    // High adjustments.
    const roomRevenue = metrics.roomRevenue ?? 0;
    if (financials.adjustmentsTotal != null && roomRevenue > 0) {
      const adjPct = (Math.abs(financials.adjustmentsTotal) / roomRevenue) * 100;
      if (adjPct > ALERT_THRESHOLDS.ADJUSTMENTS_HIGH_PCT) {
        alerts.push({
          alertType: 'excessive_adjustments',
          severity: adjPct > 10 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
          title: `Adjustments are ${adjPct.toFixed(1)}% of room revenue`,
          description: `Total adjustments of $${Math.abs(financials.adjustmentsTotal).toLocaleString()} exceed normal thresholds.`,
          metricName: 'adjustments_total',
          metricValue: financials.adjustmentsTotal,
          thresholdValue: ALERT_THRESHOLDS.ADJUSTMENTS_HIGH_PCT,
          pctChange: adjPct,
        });
      }
    }

    // High voids.
    if (financials.voidsTotal != null && roomRevenue > 0) {
      const voidPct = (Math.abs(financials.voidsTotal) / roomRevenue) * 100;
      if (voidPct > ALERT_THRESHOLDS.VOIDS_HIGH_PCT) {
        alerts.push({
          alertType: 'excessive_voids',
          severity: voidPct > 8 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
          title: `Voids are ${voidPct.toFixed(1)}% of room revenue`,
          description: `$${Math.abs(financials.voidsTotal).toLocaleString()} in voids detected — possible unauthorized transactions.`,
          metricName: 'voids_total',
          metricValue: financials.voidsTotal,
          thresholdValue: ALERT_THRESHOLDS.VOIDS_HIGH_PCT,
          pctChange: voidPct,
        });
      }
    }

    // Cash variance.
    if (financials.cashVariance != null) {
      const absVariance = Math.abs(financials.cashVariance);
      if (absVariance > ALERT_THRESHOLDS.CASH_VARIANCE_ABS) {
        alerts.push({
          alertType: 'cash_variance',
          severity: absVariance > 2000 ? SEVERITY.CRITICAL : SEVERITY.HIGH,
          title: `Cash variance of $${absVariance.toLocaleString()}`,
          description: `Cash variance of ${financials.cashVariance >= 0 ? '+' : ''}$${financials.cashVariance.toLocaleString()} requires investigation.`,
          metricName: 'cash_variance',
          metricValue: financials.cashVariance,
          thresholdValue: ALERT_THRESHOLDS.CASH_VARIANCE_ABS,
        });
      }
    }

    return alerts;
  }
}
