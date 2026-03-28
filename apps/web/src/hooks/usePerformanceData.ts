/**
 * Fetches daily hotel performance data for a single date from Supabase.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { DailyHotelPerformance } from '../components/stoneriver/types';

export function usePerformanceData(date: string) {
  return useQuery({
    queryKey: ['stoneriver-perf', date],
    queryFn: async (): Promise<DailyHotelPerformance[]> => {
      const { data, error } = await supabase
        .from('daily_hotel_performance')
        .select('*')
        .eq('report_date', date);
      if (error) throw new Error(error.message);
      return (data ?? []) as DailyHotelPerformance[];
    },
    enabled: !!date,
    staleTime: 5 * 60 * 1000,
  });
}
