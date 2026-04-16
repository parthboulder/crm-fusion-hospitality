/**
 * Fetches daily hotel performance data for a single date via the API.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api-client';
import type { DailyHotelPerformance } from '../components/stoneriver/types';

export function usePerformanceData(date: string) {
  return useQuery({
    queryKey: ['stoneriver-perf', date],
    queryFn: async (): Promise<DailyHotelPerformance[]> => {
      const resp = await api.get<{ data: DailyHotelPerformance[] }>(
        `/performance/revenue-flash?date=${date}`,
      );
      return resp.data;
    },
    enabled: !!date,
    staleTime: 5 * 60_000,
  });
}
