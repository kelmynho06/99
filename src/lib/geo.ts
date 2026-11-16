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

interface PhotonFeature {
  properties?: {
    osm_key?: string;
    osm_value?: string;
    type?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    locality?: string;
    city?: string;
    county?: string;
    state?: string;
    countrycode?: string;
  };
  geometry?: {
    coordinates?: [number, number];
  };
}

function classifyPhotonType(props: NonNullable<PhotonFeature['properties']>): string {
  const key = (props.osm_key || '').toLowerCase();
  const val = (props.osm_value || '').toLowerCase();
  if (key === 'amenity' || val.includes('hospital') || val.includes('clinic')) {
    return val.includes('hospital') || val.includes('clinic') ? 'Saúde' : 'Ponto comercial';
  }
  if (key === 'shop' || val.includes('mall') || val.includes('supermarket')) return 'Comércio';
  if (key === 'leisure' || val.includes('park') || val.includes('square')) return 'Parque / Praça';
  if (key === 'tourism' || key === 'historic') return 'Referência';
  if (props.housenumber) return 'Endereço exato';
  if (key === 'highway' || props.type === 'street') return 'Rua / Av.';
  return 'Local';
}

function formatPhotonAddress(
  props: NonNullable<PhotonFeature['properties']>,
  typedQuery?: string
): string {
  const name = (props.name || '').trim();
  const street = (props.street || '').trim();
  const typedNum = typedQuery ? extractTypedHouseNumber(typedQuery) : null;
  const houseNumber = props.housenumber || (street || name ? typedNum : null);
  const district = (props.district || props.locality || '').trim();
  const city = (props.city || props.county || '').trim();
  const state = (props.state || '').trim();

  const parts: string[] = [];
  if (name && street && name.toLowerCase() !== street.toLowerCase()) {
    parts.push(name);
    parts.push(houseNumber ? `${street}, ${houseNumber}` : street);
  } else if (street) {
    parts.push(houseNumber ? `${street}, ${houseNumber}` : street);
  } else if (name) {
    parts.push(houseNumber && !name.includes(houseNumber) ? `${name}, ${houseNumber}` : name);
  }
  if (district && !parts.some((p) => p.toLowerCase() === district.toLowerCase())) {
    parts.push(district);
  }
  if (city) {
    parts.push(state ? `${city} - ${state}` : city);
  }
  return parts.join(' · ') || 'Local selecionado';
}

export async function searchAddresses(
  query: string,
  nearLat?: number,
  nearLng?: number,
  signal?: AbortSignal
): Promise<AddressSuggestion[]> {
  const clean = query.trim();
  if (clean.length < 2) return [];

  const hasLocalCoords =
    typeof nearLat === 'number' &&
    typeof nearLng === 'number' &&
    Number.isFinite(nearLat) &&
    Number.isFinite(nearLng);

  const MAX_LOCAL_RADIUS_KM = 85;
  const results: AddressSuggestion[] = [];
  const seen = new Set<string>();

  // 1. Ultra-fast Photon search constrained to local GPS bbox
  try {
    const params = new URLSearchParams({
      q: clean,
      limit: '12',
    });
    if (hasLocalCoords) {
      params.set('lat', String(nearLat));
      params.set('lon', String(nearLng));
      params.set('location_bias_scale', '0.1');
      // ~90km x 90km bounding box centered on user's current GPS
      const delta = 0.45;
      params.set(
        'bbox',
        `${nearLng - delta},${nearLat - delta},${nearLng + delta},${nearLat + delta}`
      );
    }

    const res = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, {
      signal,
      headers: { Accept: 'application/json' },
    });

    if (res.ok) {
      const json = (await res.json()) as { features?: PhotonFeature[] };
      for (const feat of json.features || []) {
        const props = feat.properties;
        const coords = feat.geometry?.coordinates;
        if (!props || !coords || coords.length < 2) continue;
        if (props.countrycode && props.countrycode.toUpperCase() !== 'BR') continue;

        const lng = Number(coords[0]);
        const lat = Number(coords[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

        const distKm = hasLocalCoords ? haversineKm(nearLat, nearLng, lat, lng) : 0;
        if (hasLocalCoords && distKm > MAX_LOCAL_RADIUS_KM) continue;

        const formatted = formatPhotonAddress(props, clean);
        const dedupeKey = `${formatted.toLowerCase()}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const city = (props.city || props.county || '').trim();
        const district = (props.district || props.locality || '').trim();
        const distTag = hasLocalCoords ? `${distKm.toFixed(1)} km` : '';
        const subtitle = [district, city, props.state, distTag].filter(Boolean).join(' · ');

        results.push({
          address: formatted,
          subtitle: subtitle || formatted,
          categoryLabel: classifyPhotonType(props),
          lat,
          lng,
        });
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return [];
  }

  // 2. Bounded local Nominatim supplement only if Photon local bbox returned < 2 matches
  if (results.length < 2 && clean.length >= 3) {
    try {
      const params = new URLSearchParams({
        q: clean,
        format: 'jsonv2',
        addressdetails: '1',
        namedetails: '1',
        extratags: '1',
        limit: '6',
        countrycodes: 'br',
        'accept-language': 'pt-BR',
      });

      if (hasLocalCoords) {
        const delta = 0.45;
        params.set(
          'viewbox',
          `${nearLng - delta},${nearLat + delta},${nearLng + delta},${nearLat - delta}`
        );
        params.set('bounded', '1');
      }

      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?${params.toString()}`,
        {
          signal,
          headers: {
            Accept: 'application/json',
            'Accept-Language': 'pt-BR,pt;q=0.9',
          },
        }
      );

      if (res.ok) {
        const data = (await res.json()) as NominatimResult[];
        for (const item of data) {
          const lat = parseFloat(item.lat);
          const lng = parseFloat(item.lon);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
          const distKm = hasLocalCoords ? haversineKm(nearLat, nearLng, lat, lng) : 0;
          if (hasLocalCoords && distKm > MAX_LOCAL_RADIUS_KM) continue;

          const formatted = formatShortAddress(item, clean);
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
          const distTag = hasLocalCoords ? `${distKm.toFixed(1)} km` : '';
          const subtitle =
            [hood, city, item.address?.state, distTag].filter(Boolean).join(' · ') ||
            item.display_name;

          results.push({
            address: formatted,
            subtitle,
            categoryLabel: classifyNominatimType(item),
            lat,
            lng,
          });
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return [];
    }
  }

  if (hasLocalCoords) {
    results.sort(
      (a, b) =>
        haversineKm(nearLat, nearLng, a.lat, a.lng) -
        haversineKm(nearLat, nearLng, b.lat, b.lng)
    );
  }

  return results.slice(0, 8);
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

export interface RouteStep {
  instruction: string;
  roadName: string;
  distanceMeters: number;
  maneuverType: string;
  modifier: string;
  location: [number, number];
}

function translateOsrmStep(
  type: string,
  modifier: string,
  roadName: string
): string {
  const street = roadName ? ` na ${roadName}` : '';
  if (type === 'depart') return roadName ? `Siga pela ${roadName}` : 'Inicie o trajeto';
  if (type === 'arrive') return 'Você chegou ao destino';
  if (type === 'roundabout' || type === 'rotary') {
    return roadName ? `Na rotatória, siga pela ${roadName}` : 'Entre na rotatória';
  }
  switch (modifier) {
    case 'left':
      return `Vire à esquerda${street}`;
    case 'slight left':
      return `Mantenha-se à esquerda${street}`;
    case 'sharp left':
      return `Curva acentuada à esquerda${street}`;
    case 'right':
      return `Vire à direita${street}`;
    case 'slight right':
      return `Mantenha-se à direita${street}`;
    case 'sharp right':
      return `Curva acentuada à direita${street}`;
    case 'uturn':
      return `Faça o retorno${street}`;
    default:
      return roadName ? `Siga em frente pela ${roadName}` : 'Siga em frente';
  }
}

export async function fetchRouteGeometry(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<{
  coords: [number, number][];
  distanceKm: number;
  durationMin: number;
  steps: RouteStep[];
}> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson&steps=true`;
    const res = await fetch(url);
    if (res.ok) {
      const json = (await res.json()) as {
        routes?: Array<{
          distance: number;
          duration: number;
          geometry: { coordinates: [number, number][] };
          legs?: Array<{
            steps?: Array<{
              distance?: number;
              name?: string;
              maneuver?: {
                type?: string;
                modifier?: string;
                location?: [number, number];
              };
            }>;
          }>;
        }>;
      };
      const route = json.routes?.[0];
      if (route) {
        const rawSteps = route.legs?.[0]?.steps || [];
        const steps: RouteStep[] = rawSteps.map((st) => {
          const maneuverType = st.maneuver?.type || 'continue';
          const modifier = st.maneuver?.modifier || 'straight';
          const roadName = (st.name || '').trim();
          const loc = st.maneuver?.location;
          return {
            instruction: translateOsrmStep(maneuverType, modifier, roadName),
            roadName,
            distanceMeters: Math.round(st.distance ?? 0),
            maneuverType,
            modifier,
            location: loc ? [loc[1], loc[0]] : [destLat, destLng],
          };
        });

        return {
          coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
          distanceKm: Math.max(0.5, Number((route.distance / 1000).toFixed(2))),
          durationMin: Math.max(2, Math.round(route.duration / 60)),
          steps,
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
    steps: [
      {
        instruction: 'Siga em direção ao ponto marcado no mapa',
        roadName: '',
        distanceMeters: Math.round(dist * 1000),
        maneuverType: 'depart',
        modifier: 'straight',
        location: [destLat, destLng],
      },
    ],
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
