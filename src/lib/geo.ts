import type { WeatherInfo } from '../types/mobility';

export interface NominatimResult {
  place_id: number;
  display_name: string;
  name?: string;
  class?: string;
  type?: string;
  lat: string;
  lon: string;
  namedetails?: {
    name?: string;
    'name:pt'?: string;
  };
  address?: {
    amenity?: string;
    shop?: string;
    leisure?: string;
    tourism?: string;
    building?: string;
    public_building?: string;
    mall?: string;
    hospital?: string;
    park?: string;
    square?: string;
    road?: string;
    pedestrian?: string;
    house_number?: string;
    suburb?: string;
    neighbourhood?: string;
    quarter?: string;
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    state?: string;
  };
}

export interface AddressSuggestion {
  address: string;
  subtitle: string;
  categoryLabel: string;
  lat: number;
  lng: number;
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

function classifyNominatimType(item: NominatimResult): string {
  const cls = (item.class || '').toLowerCase();
  const tp = (item.type || '').toLowerCase();
  if (cls === 'amenity' || tp.includes('hospital') || tp.includes('clinic')) {
    return tp.includes('hospital') || tp.includes('clinic') ? 'Saúde' : 'Ponto comercial';
  }
  if (cls === 'shop' || tp.includes('mall') || tp.includes('supermarket')) return 'Comércio';
  if (cls === 'leisure' || tp.includes('park') || tp.includes('square')) return 'Parque / Praça';
  if (cls === 'tourism' || cls === 'historic') return 'Referência';
  if (item.address?.house_number) return 'Endereço exato';
  if (cls === 'highway') return 'Rua / Av.';
  return 'Local';
}

function extractTypedHouseNumber(rawQuery: string): string | null {
  const match = rawQuery.match(/(?:,\s*|\s+n[º°]?\s*|\s+)(\d{1,5}[A-Za-z]?)\s*$/i);
  return match ? match[1] : null;
}

export function formatShortAddress(item: NominatimResult, typedQuery?: string): string {
  const a = item.address;
  const poiName =
    item.namedetails?.['name:pt'] ||
    item.namedetails?.name ||
    item.name ||
    a?.amenity ||
    a?.shop ||
    a?.leisure ||
    a?.tourism ||
    a?.mall ||
    a?.hospital ||
    a?.park ||
    a?.building ||
    '';

  const road = a?.road || a?.pedestrian || '';
  const typedNum = typedQuery ? extractTypedHouseNumber(typedQuery) : null;
  const houseNumber = a?.house_number || (road && typedNum ? typedNum : '');
  const roadWithNum = road ? (houseNumber ? `${road}, ${houseNumber}` : road) : '';
  const hood = a?.neighbourhood || a?.suburb || a?.quarter || '';
  const city = a?.city || a?.town || a?.municipality || a?.village || '';
  const state = a?.state || '';

  const parts: string[] = [];
  if (poiName && !roadWithNum.toLowerCase().includes(poiName.toLowerCase())) {
    parts.push(poiName);
  }
  if (roadWithNum) parts.push(roadWithNum);
  if (hood) parts.push(hood);
  if (city) parts.push(state ? `${city} - ${state}` : city);

  if (parts.length > 0) {
    return parts.join(' · ');
  }
  return item.display_name.split(',').slice(0, 4).join(', ').trim();
}

export async function searchAddresses(
  query: string,
  nearLat?: number,
  nearLng?: number
): Promise<AddressSuggestion[]> {
  const clean = query.trim();
  if (clean.length < 3) return [];

  const params = new URLSearchParams({
    q: clean,
    format: 'jsonv2',
    addressdetails: '1',
    namedetails: '1',
    extratags: '1',
    limit: '8',
    countrycodes: 'br',
    'accept-language': 'pt-BR',
  });

  if (typeof nearLat === 'number' && typeof nearLng === 'number') {
    const viewbox = `${nearLng - 0.65},${nearLat + 0.65},${nearLng + 0.65},${nearLat - 0.65}`;
    params.set('viewbox', viewbox);
    params.set('bounded', '0');
  }

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as NominatimResult[];

    const seen = new Set<string>();
    const results: AddressSuggestion[] = [];
    for (const item of data) {
      const formatted = formatShortAddress(item, clean);
      const lat = parseFloat(item.lat);
      const lng = parseFloat(item.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const dedupeKey = `${formatted.toLowerCase()}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const city =
        item.address?.city ||
        item.address?.town ||
        item.address?.municipality ||
        item.address?.village ||
        '';
      const hood = item.address?.neighbourhood || item.address?.suburb || '';
      const subtitle = [hood, city, item.address?.state].filter(Boolean).join(' · ') || item.display_name;

      results.push({
        address: formatted,
        subtitle,
        categoryLabel: classifyNominatimType(item),
        lat,
        lng,
      });
    }
    return results;
  } catch {
    return [];
  }
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&namedetails=1&accept-language=pt-BR`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    const data = (await res.json()) as NominatimResult;
    return formatShortAddress(data);
  } catch {
    return `Localização atual (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
  }
}

export async function reverseGeocodeCity(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&zoom=10&accept-language=pt-BR`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return '';
    const data = (await res.json()) as NominatimResult;
    const city =
      data.address?.city ||
      data.address?.town ||
      data.address?.municipality ||
      data.address?.village ||
      '';
    const state = data.address?.state || '';
    return [city, state].filter(Boolean).join(' - ');
  } catch {
    return '';
  }
}

function describeWmoWeatherCode(code: number): string {
  if (code === 0) return 'Céu limpo';
  if (code <= 3) return 'Parcialmente nublado';
  if (code === 45 || code === 48) return 'Neblina';
  if (code >= 51 && code <= 67) return 'Chuva leve';
  if (code >= 71 && code <= 77) return 'Granizo / Frio';
  if (code >= 80 && code <= 82) return 'Pancadas de chuva';
  if (code >= 95) return 'Tempestade';
  return 'Clima estável';
}

export async function fetchLocalWeather(lat: number, lng: number): Promise<WeatherInfo | null> {
  try {
    const [weatherRes, city] = await Promise.all([
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&timezone=auto`
      ),
      reverseGeocodeCity(lat, lng),
    ]);
    if (!weatherRes.ok) return null;
    const json = (await weatherRes.json()) as {
      current?: { temperature_2m?: number; weather_code?: number };
    };
    const temp = json.current?.temperature_2m;
    const code = json.current?.weather_code ?? 0;
    if (typeof temp !== 'number') return null;

    return {
      temperatureC: Math.round(temp),
      weatherCode: code,
      label: describeWmoWeatherCode(code),
      city: city || 'Localização atual',
    };
  } catch {
    return null;
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

function tlv(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

function stripDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 .\-@/]/g, '');
}

export function computeCrc16Ccitt(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc <<= 1;
      }
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function buildPixEmvPayload(
  pixKey: string,
  receiverName: string,
  city: string,
  amount: number,
  txId: string
): string {
  const cleanKey = pixKey.trim();
  const cleanName = (stripDiacritics(receiverName) || 'VELO99').slice(0, 25).toUpperCase();
  const cleanCity = (stripDiacritics(city.split(',')[0].split('-')[0]) || 'BRASIL')
    .trim()
    .slice(0, 15)
    .toUpperCase();
  const cleanTx = txId.replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase() || 'VELO99';

  const merchantInfo = tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', cleanKey);
  const additionalData = tlv('05', cleanTx);

  const withoutCrc =
    tlv('00', '01') +
    tlv('26', merchantInfo) +
    tlv('52', '0000') +
    tlv('53', '986') +
    tlv('54', amount.toFixed(2)) +
    tlv('58', 'BR') +
    tlv('59', cleanName) +
    tlv('60', cleanCity) +
    tlv('62', additionalData) +
    '6304';

  return `${withoutCrc}${computeCrc16Ccitt(withoutCrc)}`;
}
