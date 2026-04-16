/**
 * Edge Function: generate-alerts
 *
 * Step 3 of the processing pipeline.
 * Triggered by: extract-report after metrics are persisted.
 *
 * Responsibilities:
 *  1. Evaluate extracted metrics against alert thresholds
 *  2. Insert alert records
 *  3. Auto-create tasks for critical/high alerts
 *  4. Send email/push notifications
 */

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getAdminClient, verifyServiceAuth } from '../_shared/supabase-client.ts';

const THRESHOLDS = {
  OCCUPANCY_DROP_PCT: 10,
  REVENUE_DROP_PCT: 15,
  ADR_BELOW_FLOOR_PCT: 5,
  AR_90_PLUS_THRESHOLD_PCT: 20,
  ADJUSTMENTS_HIGH_PCT: 5,
  VOIDS_HIGH_PCT: 3,
  OOO_ROOMS_HIGH_PCT: 10,
  CASH_VARIANCE_ABS: 500,
};

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (!verifyServiceAuth(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { reportId, propertyId, orgId, metrics, financials } = await req.json() as {
    reportId: string;
    propertyId: string;
    orgId: string;
    metrics: Record<string, number | null>;
    financials: Record<string, number | null>;
  };

  const supabase = getAdminClient();

  // Fetch property for adr_floor threshold.
  const { data: property } = await supabase
    .from('properties')
    .select('id, name, adr_floor, total_rooms')
    .eq('id', propertyId)
    .single();

  const alertsToCreate: AlertInsert[] = [];

  // ─── Performance Checks ───────────────────────────────────────────────────

  const occ = metrics['occupancy_pct'];
  const pyOcc = metrics['py_occupancy_pct'];
  if (occ != null && pyOcc != null && pyOcc > 0) {
    const drop = ((pyOcc - occ) / pyOcc) * 100;
    if (drop > THRESHOLDS.OCCUPANCY_DROP_PCT) {
      alertsToCreate.push({
        org_id: orgId,
        property_id: propertyId,
        report_id: reportId,
        alert_type: 'occupancy_drop_yoy',
        severity: drop > 20 ? 'critical' : 'high',
        title: `Occupancy down ${drop.toFixed(1)}% YoY`,
        description: `Occupancy is ${occ.toFixed(1)}% vs ${pyOcc.toFixed(1)}% prior year.`,
        metric_name: 'occupancy_pct',
        metric_value: occ,
        prior_value: pyOcc,
        pct_change: -drop,
        threshold_value: THRESHOLDS.OCCUPANCY_DROP_PCT,
      });
    }
  }

  const rev = metrics['total_revenue'];
  const pyRev = metrics['py_total_revenue'];
  if (rev != null && pyRev != null && pyRev > 0) {
    const drop = ((pyRev - rev) / pyRev) * 100;
    if (drop > THRESHOLDS.REVENUE_DROP_PCT) {
      alertsToCreate.push({
        org_id: orgId,
        property_id: propertyId,
        report_id: reportId,
        alert_type: 'revenue_drop_yoy',
        severity: drop > 25 ? 'critical' : 'high',
        title: `Revenue down ${drop.toFixed(1)}% YoY`,
        description: `Total revenue $${rev.toLocaleString()} vs $${pyRev.toLocaleString()} prior year.`,
        metric_name: 'total_revenue',
        metric_value: rev,
        prior_value: pyRev,
        pct_change: -drop,
        threshold_value: THRESHOLDS.REVENUE_DROP_PCT,
      });
    }
  }

  const adr = metrics['adr'];
  const adrFloor = property?.adr_floor ? Number(property.adr_floor) : null;
  if (adr != null && adrFloor != null && adrFloor > 0) {
    const pctBelow = ((adrFloor - adr) / adrFloor) * 100;
    if (pctBelow > THRESHOLDS.ADR_BELOW_FLOOR_PCT) {
      alertsToCreate.push({
        org_id: orgId,
        property_id: propertyId,
        report_id: reportId,
        alert_type: 'adr_below_floor',
        severity: 'high',
        title: `ADR $${adr.toFixed(2)} below floor $${adrFloor.toFixed(2)}`,
        description: `ADR is ${pctBelow.toFixed(1)}% below property floor rate.`,
        metric_name: 'adr',
        metric_value: adr,
        threshold_value: adrFloor,
        pct_change: -pctBelow,
      });
    }
  }

  const ooo = metrics['rooms_ooo'];
  const totalRooms = metrics['total_rooms'] ?? (property?.total_rooms ? Number(property.total_rooms) : null);
  if (ooo != null && totalRooms != null && totalRooms > 0) {
    const oooPct = (ooo / totalRooms) * 100;
    if (oooPct > THRESHOLDS.OOO_ROOMS_HIGH_PCT) {
      alertsToCreate.push({
        org_id: orgId,
        property_id: propertyId,
        report_id: reportId,
        alert_type: 'high_ooo_rooms',
        severity: 'medium',
        title: `${ooo} rooms out of order (${oooPct.toFixed(1)}%)`,
        description: `${ooo} of ${totalRooms} rooms are out of order.`,
        metric_name: 'rooms_ooo',
        metric_value: ooo,
        threshold_value: THRESHOLDS.OOO_ROOMS_HIGH_PCT,
        pct_change: oooPct,
      });
    }
  }

  // ─── Financial Checks ─────────────────────────────────────────────────────

  const ar90plus = financials['ar_90_plus_days'];
  const arTotal = financials['ar_total'];
  if (ar90plus != null && arTotal != null && arTotal > 0) {
    const pct = (ar90plus / arTotal) * 100;
    if (pct > THRESHOLDS.AR_90_PLUS_THRESHOLD_PCT) {
      alertsToCreate.push({
        org_id: orgId,
        property_id: propertyId,
        report_id: reportId,
        alert_type: 'high_ar_aging',
        severity: pct > 35 ? 'high' : 'medium',
        title: `AR aging: ${pct.toFixed(1)}% is 90+ days`,
        description: `$${ar90plus.toLocaleString()} of $${arTotal.toLocaleString()} AR is 90+ days old.`,
        metric_name: 'ar_90_plus_days',
        metric_value: ar90plus,
        threshold_value: THRESHOLDS.AR_90_PLUS_THRESHOLD_PCT,
        pct_change: pct,
      });
    }
  }

  const adjTotal = financials['adjustments_total'];
  const roomRev = metrics['room_revenue'] ?? 0;
  if (adjTotal != null && roomRev > 0) {
    const adjPct = (Math.abs(adjTotal) / roomRev) * 100;
    if (adjPct > THRESHOLDS.ADJUSTMENTS_HIGH_PCT) {
      alertsToCreate.push({
        org_id: orgId,
        property_id: propertyId,
        report_id: reportId,
        alert_type: 'excessive_adjustments',
        severity: adjPct > 10 ? 'high' : 'medium',
        title: `Adjustments are ${adjPct.toFixed(1)}% of room revenue`,
        description: `$${Math.abs(adjTotal).toLocaleString()} in adjustments.`,
        metric_name: 'adjustments_total',
        metric_value: adjTotal,
        threshold_value: THRESHOLDS.ADJUSTMENTS_HIGH_PCT,
        pct_change: adjPct,
      });
    }
  }

  const voidsTotal = financials['voids_total'];
  if (voidsTotal != null && roomRev > 0) {
    const voidPct = (Math.abs(voidsTotal) / roomRev) * 100;
    if (voidPct > THRESHOLDS.VOIDS_HIGH_PCT) {
      alertsToCreate.push({
        org_id: orgId,
        property_id: propertyId,
        report_id: reportId,
        alert_type: 'excessive_voids',
        severity: voidPct > 8 ? 'high' : 'medium',
        title: `Voids are ${voidPct.toFixed(1)}% of room revenue`,
        description: `$${Math.abs(voidsTotal).toLocaleString()} in voids — possible unauthorized transactions.`,
        metric_name: 'voids_total',
        metric_value: voidsTotal,
        threshold_value: THRESHOLDS.VOIDS_HIGH_PCT,
        pct_change: voidPct,
      });
    }
  }

  const cashVariance = financials['cash_variance'];
  if (cashVariance != null && Math.abs(cashVariance) > THRESHOLDS.CASH_VARIANCE_ABS) {
    alertsToCreate.push({
      org_id: orgId,
      property_id: propertyId,
      report_id: reportId,
      alert_type: 'cash_variance',
      severity: Math.abs(cashVariance) > 2000 ? 'critical' : 'high',
      title: `Cash variance $${Math.abs(cashVariance).toLocaleString()}`,
      description: `Cash variance of ${cashVariance >= 0 ? '+' : ''}$${cashVariance.toLocaleString()} requires investigation.`,
      metric_name: 'cash_variance',
      metric_value: cashVariance,
      threshold_value: THRESHOLDS.CASH_VARIANCE_ABS,
    });
  }

  // ─── Persist Alerts + Auto-Tasks ──────────────────────────────────────────

  for (const alert of alertsToCreate) {
    const { data: created } = await supabase
      .from('alerts')
      .insert(alert)
      .select('id')
      .single();

    if (created && (alert.severity === 'critical' || alert.severity === 'high')) {
      await supabase.from('tasks').insert({
        org_id: orgId,
        property_id: propertyId,
        alert_id: created.id,
        title: `Investigate: ${alert.title}`,
        description: alert.description,
        task_type: alert.alert_type,
        priority: alert.severity,
        status: 'open',
      });
    }
  }

  console.log(`generate-alerts: created ${alertsToCreate.length} alerts for report ${reportId}`);

  return new Response(
    JSON.stringify({ success: true, alertsCreated: alertsToCreate.length }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface AlertInsert {
  org_id: string;
  property_id: string;
  report_id: string;
  alert_type: string;
  severity: string;
  title: string;
  description: string;
  metric_name?: string;
  metric_value?: number | null;
  threshold_value?: number | null;
  prior_value?: number | null;
  pct_change?: number | null;
}
