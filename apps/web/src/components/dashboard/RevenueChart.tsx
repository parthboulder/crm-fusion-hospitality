/**
 * Portfolio revenue trend — 30-day area chart.
 */

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { format, parseISO } from 'date-fns';

interface MetricRow {
  metricDate: string;
  totalRevenue: number | null;
  pyTotalRevenue: number | null;
}

interface TrendsResponse {
  data: { current: MetricRow[] };
}

function formatRevenue(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

export function RevenueChart() {
  const { data, isLoading } = useQuery<TrendsResponse>({
    queryKey: ['trends', '30d'],
    queryFn: () => api.get('/metrics/trends?period=30d'),
  });

  if (isLoading) {
    return (
      <div className="card p-5">
        <div className="h-48 bg-neutral-100 rounded animate-pulse" />
      </div>
    );
  }

  const chartData = (data?.data.current ?? []).map((row) => ({
    date: format(parseISO(row.metricDate), 'MMM d'),
    revenue: row.totalRevenue ? Number(row.totalRevenue) : null,
    pyRevenue: row.pyTotalRevenue ? Number(row.pyTotalRevenue) : null,
  }));

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-neutral-700">Revenue — Last 30 Days</h2>
        <div className="flex items-center gap-4 text-xs text-neutral-400">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-px bg-[#1a1a1a] inline-block" /> Current
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-px bg-neutral-300 inline-block" /> Prior Year
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#1a1a1a" stopOpacity={0.12} />
              <stop offset="95%" stopColor="#1a1a1a" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={formatRevenue}
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            width={52}
          />
          <Tooltip
            formatter={(v: number) => formatRevenue(v)}
            contentStyle={{
              borderRadius: '4px', border: '1px solid #e5e7eb',
              boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.08)',
              fontSize: '12px',
            }}
          />
          <Area
            type="monotone"
            dataKey="pyRevenue"
            stroke="#d1d5db"
            strokeWidth={1.5}
            fill="none"
            dot={false}
            name="Prior Year"
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="#1a1a1a"
            strokeWidth={2}
            fill="url(#gradRevenue)"
            dot={false}
            name="Current"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
