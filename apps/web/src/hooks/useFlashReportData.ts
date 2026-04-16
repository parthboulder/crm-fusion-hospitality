/**
 * React Query hook for Flash Report data via the API.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api-client';
import type { FlashReportProperty } from '../components/stoneriver/flash-report-types';

export function useFlashReportData(date: string) {
  return useQuery<FlashReportProperty[]>({
    queryKey: ['flash-report', date],
    queryFn: async () => {
      const resp = await api.get<{ data: FlashReportProperty[] }>(
        `/performance/flash-report?date=${date}`,
      );
      return resp.data;
    },
    enabled: !!date,
    staleTime: 5 * 60_000,
  });
}
