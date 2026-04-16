/**
 * Fetches last 30 days of performance data for sparkline trend cards via the API.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api-client';
import type { SparklinePoint } from '../components/stoneriver/types';

export function useSparklineData(endDate: string) {
  return useQuery({
    queryKey: ['stoneriver-sparklines', endDate],
    queryFn: async (): Promise<SparklinePoint[]> => {
      const resp = await api.get<{ data: SparklinePoint[] }>(
        `/performance/revenue-flash/sparklines?endDate=${endDate}`,
      );
      return resp.data;
    },
    enabled: !!endDate,
    staleTime: 5 * 60_000,
  });
}
