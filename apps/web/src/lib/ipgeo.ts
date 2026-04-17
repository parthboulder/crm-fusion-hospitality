/**
 * IP + geolocation lookups for UI display.
 *
 * - `useMyIp()` — the current browser's public IP (ipify) plus city/country (ipwho.is).
 * - `useIpGeo(ip)` — geolocation for an arbitrary IP, with React Query caching so
 *   multiple rows sharing the same IP only trigger one network request.
 *
 * Note: these are *display-only* values. The authoritative IP for audit/security
 * purposes is the server-captured `req.ip`. Never feed these back to the server
 * as a trusted identity.
 */

import { useQuery } from '@tanstack/react-query';

export interface IpGeo {
  ip: string;
  city: string | null;
  region: string | null;
  country: string | null;
}

interface IpifyResponse {
  ip: string;
}

interface IpWhoIsResponse {
  success: boolean;
  ip?: string;
  city?: string;
  region?: string;
  country?: string;
  message?: string;
}

interface IpApiCoResponse {
  ip?: string;
  city?: string;
  region?: string;
  country_name?: string;
  error?: boolean;
  reason?: string;
}

interface FreeIpApiResponse {
  ipAddress?: string;
  cityName?: string;
  regionName?: string;
  countryName?: string;
}

async function fetchMyIp(): Promise<string> {
  const res = await fetch('https://api.ipify.org?format=json');
  if (!res.ok) throw new Error(`ipify ${res.status}`);
  const json = (await res.json()) as IpifyResponse;
  if (!json.ip) throw new Error('ipify: missing ip');
  return json.ip;
}

/**
 * Tries a chain of no-key geo providers in order. Any one working is enough.
 * Providers rate-limit/block aggressively, so we fall through on errors
 * instead of surfacing them to the caller.
 */
async function fetchGeo(ip: string): Promise<IpGeo> {
  const encoded = ip ? encodeURIComponent(ip) : '';

  // 1. ipapi.co — JSON, 1000 reqs/day per IP, no key.
  try {
    const url = encoded ? `https://ipapi.co/${encoded}/json/` : 'https://ipapi.co/json/';
    const res = await fetch(url);
    if (res.ok) {
      const json = (await res.json()) as IpApiCoResponse;
      if (!json.error && (json.city || json.country_name || json.ip)) {
        return {
          ip: json.ip ?? ip,
          city: json.city ?? null,
          region: json.region ?? null,
          country: json.country_name ?? null,
        };
      }
    }
  } catch {
    /* fall through */
  }

  // 2. freeipapi.com — JSON, generous free tier, no key.
  try {
    const url = encoded ? `https://freeipapi.com/api/json/${encoded}` : 'https://freeipapi.com/api/json/';
    const res = await fetch(url);
    if (res.ok) {
      const json = (await res.json()) as FreeIpApiResponse;
      if (json.ipAddress || json.cityName) {
        return {
          ip: json.ipAddress ?? ip,
          city: json.cityName ?? null,
          region: json.regionName ?? null,
          country: json.countryName ?? null,
        };
      }
    }
  } catch {
    /* fall through */
  }

  // 3. ipwho.is — legacy fallback; occasionally 403s so it's last.
  try {
    const url = encoded ? `https://ipwho.is/${encoded}` : 'https://ipwho.is/';
    const res = await fetch(url);
    if (res.ok) {
      const json = (await res.json()) as IpWhoIsResponse;
      if (json.success) {
        return {
          ip: json.ip ?? ip,
          city: json.city ?? null,
          region: json.region ?? null,
          country: json.country ?? null,
        };
      }
    }
  } catch {
    /* fall through */
  }

  // All providers failed — return just the IP so the caller at least shows that.
  return { ip, city: null, region: null, country: null };
}

export function useMyIp() {
  return useQuery<IpGeo>({
    queryKey: ['my-ip'],
    queryFn: async () => {
      const ip = await fetchMyIp();
      return fetchGeo(ip);
    },
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
  });
}

/**
 * Lookup geo for a specific IP. Returns null for empty/local/private IPs
 * rather than burning a network call.
 */
export function useIpGeo(ip: string | null | undefined) {
  const normalized = (ip ?? '').trim();
  const isPublic =
    !!normalized &&
    normalized !== '127.0.0.1' &&
    normalized !== '::1' &&
    !normalized.startsWith('10.') &&
    !normalized.startsWith('192.168.') &&
    !/^172\.(1[6-9]|2\d|3[01])\./.test(normalized);

  return useQuery<IpGeo>({
    queryKey: ['ip-geo', normalized],
    queryFn: () => fetchGeo(normalized),
    enabled: isPublic,
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: 1,
  });
}

export function formatLocation(geo: IpGeo | null | undefined): string {
  if (!geo) return '';
  const parts = [geo.city, geo.country].filter(Boolean);
  return parts.join(', ');
}
