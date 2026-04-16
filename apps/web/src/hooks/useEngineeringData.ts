/**
 * React Query hook for Engineering Flash data via the API.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api-client';
import type { EngineeringFlashData, OOORoom } from '../components/stoneriver/engineering-types';

export function useEngineeringData(date: string) {
  return useQuery<EngineeringFlashData>({
    queryKey: ['engineering-flash', date],
    queryFn: async () => {
      const resp = await api.get<{ data: Array<{
        property_name: string;
        room_number: string;
        date_ooo: string | null;
        reason: string | null;
        notes: string | null;
        is_long_term: boolean;
      }> }>(`/performance/engineering?date=${date}`);

      const rows = resp.data;
      const oooRooms: OOORoom[] = [];
      const longTermRooms: OOORoom[] = [];

      for (const row of rows) {
        const room: OOORoom = {
          hotel: row.property_name,
          propertyName: row.property_name,
          roomNumber: row.room_number,
          dateOOO: row.date_ooo ?? '',
          reason: row.reason ?? '',
          notes: row.notes ?? '',
          isLongTerm: row.is_long_term,
        };
        if (row.is_long_term) longTermRooms.push(room);
        else oooRooms.push(room);
      }

      return { reportDate: date, oooRooms, longTermRooms };
    },
    enabled: !!date,
    staleTime: 5 * 60_000,
  });
}
