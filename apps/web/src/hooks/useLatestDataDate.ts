/**
 * Fetches the most recent date that has data via the API (service role key).
 * Used by dashboards to auto-select the latest date instead of
 * blindly defaulting to yesterday (which may have no data).
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api-client';
import { format, subDays } from 'date-fns';

const YESTERDAY = format(subDays(new Date(), 1), 'yyyy-MM-dd');

export function useLatestDataDate(
  table: 'daily_hotel_performance' | 'flash_report' | 'engineering_ooo_rooms',
) {
  return useQuery({
    queryKey: ['latest-date', table],
    queryFn: async (): Promise<string> => {
      try {
        const resp = await api.get<{ data: { date: string | null } }>(
          `/performance/latest-date?table=${table}`,
        );
        return resp.data.date ?? YESTERDAY;
      } catch {
        return YESTERDAY;
      }
    },
    staleTime: 10 * 60_000,
  });
}
