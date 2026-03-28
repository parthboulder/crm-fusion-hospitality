/**
 * Portfolio dashboard — KPI strip, property grid, alerts panel, revenue chart.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api-client';
import { KpiCard } from '../components/dashboard/KpiCard';
import { PropertyCard } from '../components/dashboard/PropertyCard';
import { AlertsSummary } from '../components/dashboard/AlertsSummary';
import { RevenueChart } from '../components/dashboard/RevenueChart';
import { fmtCurrency, fmtPct } from '../lib/formatters';

interface PortfolioSummary {
  data: {
    todayMetrics: {
      _sum: { totalRevenue: string | null; roomsSold: number | null };
      _avg: { occupancyPct: string | null; adr: string | null; revpar: string | null };
      _count: { id: number };
    };
    openAlerts: Array<{ severity: string; _count: { id: number } }>;
  };
}

interface PropertiesResponse {
  data: Array<{
    id: string;
    name: string;
    brand: string | null;
    city: string | null;
    state: string | null;
    _count: { alerts: number };
    latestMetrics?: {
      occupancyPct: number;
      adr: number;
      revpar: number;
      totalRevenue: number;
      pyTotalRevenue: number;
      pyRevpar: number;
    } | null;
  }>;
}

interface TrendsResponse {
  data: {
    aggregates: {
      _avg: { occupancyPct: string | null; adr: string | null; revpar: string | null };
      _sum: { totalRevenue: string | null };
    };
  };
}

export function DashboardPage() {
  const { data: summary, isLoading: summaryLoading } = useQuery<PortfolioSummary>({
    queryKey: ['portfolio-summary'],
    queryFn: () => api.get('/properties/portfolio/summary'),
    refetchInterval: 300_000,
  });

  const { data: properties, isLoading: propertiesLoading } = useQuery<PropertiesResponse>({
    queryKey: ['properties'],
    queryFn: () => api.get('/properties'),
  });

  const { data: trends } = useQuery<TrendsResponse>({
    queryKey: ['trends', '30d'],
    queryFn: () => api.get('/metrics/trends?period=30d'),
  });

  const today = summary?.data.todayMetrics;
  const agg = trends?.data.aggregates;

  const totalAlerts = (summary?.data.openAlerts ?? []).reduce((s, a) => s + a._count.id, 0);
  const criticalAlerts = (summary?.data.openAlerts ?? [])
    .find((a) => a.severity === 'critical')?._count.id ?? 0;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-base font-semibold text-neutral-900 tracking-tight">Portfolio Overview</h1>
        <p className="text-xs text-neutral-400 mt-0.5">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3 mb-5">
        <KpiCard
          label="Today's Revenue"
          value={fmtCurrency(today?._sum.totalRevenue)}
          loading={summaryLoading}
        />
        <KpiCard
          label="Avg Occupancy (30d)"
          value={fmtPct(agg?._avg.occupancyPct)}
          loading={!agg}
        />
        <KpiCard
          label="Avg ADR (30d)"
          value={fmtCurrency(agg?._avg.adr)}
          loading={!agg}
        />
        <KpiCard
          label="Avg RevPAR (30d)"
          value={fmtCurrency(agg?._avg.revpar)}
          loading={!agg}
        />
        <KpiCard
          label="Open Alerts"
          value={String(totalAlerts)}
          subValue={criticalAlerts > 0 ? `${criticalAlerts} critical` : undefined}
          loading={summaryLoading}
        />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Left: Properties + Chart */}
        <div className="xl:col-span-2 space-y-5">
          <RevenueChart />

          <div>
            <h2 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3">Properties</h2>
            {propertiesLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="card h-32 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(properties?.data ?? []).map((p) => (
                  <PropertyCard
                    key={p.id}
                    id={p.id}
                    name={p.name}
                    brand={p.brand}
                    city={p.city}
                    state={p.state}
                    latestMetrics={p.latestMetrics}
                    openAlerts={p._count.alerts}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Alerts */}
        <div className="xl:col-span-1">
          <AlertsSummary />
        </div>
      </div>
    </div>
  );
}
