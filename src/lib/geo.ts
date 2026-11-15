export interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  address?: {
    road?: string;
    suburb?: string;
    neighbourhood?: string;
    city?: string;
    town?: string;
    state?: string;
  };
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Number((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2));
}

export function formatShortAddress(item: NominatimResult): string {
  if (item.address) {
    const road = item.address.road || '';
    const hood = item.address.suburb || item.address.neighbourhood || '';
    const city = item.address.city || item.address.town || '';
    const parts = [road, hood, city].filter(Boolean);
    if (parts.length > 0) return parts.join(' · ');
  }
  return item.display_name.split(',').slice(0, 3).join(',');
}

export async function searchAddresses(
  query: string,
  nearLat?: number,
  nearLng?: number
): Promise<Array<{ address: string; lat: number; lng: number }>> {
  const clean = query.trim();
  if (clean.length < 3) return [];

  const params = new URLSearchParams({
    q: clean,
    format: 'json',
    addressdetails: '1',
    limit: '5',
    countrycodes: 'br',
  });

  if (typeof nearLat === 'number' && typeof nearLng === 'number') {
    const viewbox = `${nearLng - 0.35},${nearLat + 0.35},${nearLng + 0.35},${nearLat - 0.35}`;
    params.set('viewbox', viewbox);
  }

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as NominatimResult[];
    return data.map((item) => ({
      address: formatShortAddress(item),
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
    }));
  } catch {
    return [];
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    const data = (await res.json()) as NominatimResult;
    return formatShortAddress(data);
  } catch {
    return `Localização atual (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
  }
}

export async function fetchRouteGeometry(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<{ coords: [number, number][]; distanceKm: number; durationMin: number }> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (res.ok) {
      const json = (await res.json()) as {
        routes?: Array<{
          distance: number;
          duration: number;
          geometry: { coordinates: [number, number][] };
        }>;
      };
      const route = json.routes?.[0];
      if (route) {
        return {
          coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
          distanceKm: Math.max(0.5, Number((route.distance / 1000).toFixed(2))),
          durationMin: Math.max(2, Math.round(route.duration / 60)),
        };
      }
    }
  } catch {
    // Fallback to Haversine straight-line estimate if OSRM is unreachable
  }

  const dist = Math.max(0.6, haversineKm(originLat, originLng, destLat, destLng));
  return {
    coords: [
      [originLat, originLng],
      [destLat, destLng],
    ],
    distanceKm: dist,
    durationMin: Math.max(3, Math.round(dist * 2.5)),
  };
}

export function buildGoogleMapsDirectionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

export function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}
