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
    residential?: string;
    hamlet?: string;
    borough?: string;
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
  isAiSuggestion?: boolean;
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
  const clean = rawQuery.trim();
  const streetPattern = clean.match(
    /(?:^|\s)(?:rua|r\.?|av\.?|avenida|travessa|tv\.?|alameda|estrada|rodovia|largo|pra[çc]a)\s+[^\d,]+?(?:,\s*|\s+n[º°o]?\s*|\s+)(\d{1,5}[A-Za-z]?)\b/i
  );
  if (streetPattern) return streetPattern[1];

  const middleOrEnd = clean.match(
    /(?:,\s*|\s+n[º°o]?\s*|\s+)(\d{1,5}[A-Za-z]?)(?=\s*$|\s*(?:,|-|bairro\b|centro\b))/i
  );
  if (middleOrEnd) return middleOrEnd[1];

  const fallback = clean.match(/\b(\d{1,5}[A-Za-z]?)\b/);
  return fallback ? fallback[1] : null;
}

function normalizeSearchQuery(rawQuery: string): {
  cleaned: string;
  compact: string;
  houseNumber: string | null;
} {
  let cleaned = rawQuery
    .trim()
    .replace(/\bR\.\s*/gi, 'Rua ')
    .replace(/\bAv\.\s*/gi, 'Avenida ')
    .replace(/\bTv\.\s*/gi, 'Travessa ')
    .replace(/\bP[çc]\.\s*/gi, 'Praça ')
    .replace(/\bn[º°]\s*/gi, ' ')
    .replace(/\s+/g, ' ');

  const houseNumber = extractTypedHouseNumber(cleaned);
  // Strip explicit "bairro" filler word while keeping the neighborhood name
  const compact = cleaned
    .replace(/\bbairro\s+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return { cleaned, compact, houseNumber };
}

function normalizeTokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

const localCityCache = new Map<string, string>();

async function resolveCachedLocalCity(lat: number, lng: number): Promise<string> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const cached = localCityCache.get(key);
  if (cached !== undefined) return cached;
  const full = await reverseGeocodeCity(lat, lng);
  const cityOnly = full.split(' - ')[0]?.trim() || '';
  localCityCache.set(key, cityOnly);
  return cityOnly;
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
    a?.residential ||
    '';

  const road = a?.road || a?.pedestrian || '';
  const typedNum = typedQuery ? extractTypedHouseNumber(typedQuery) : null;
  const houseNumber = a?.house_number || (road && typedNum ? typedNum : '');
  const roadWithNum = road ? (houseNumber ? `${road}, ${houseNumber}` : road) : '';
  const residential = (a?.residential || '').trim();
  const hood = a?.neighbourhood || a?.suburb || a?.quarter || a?.borough || a?.hamlet || '';
  const city = a?.city || a?.town || a?.municipality || a?.village || '';
  const state = a?.state || '';

  const parts: string[] = [];
  if (poiName && !roadWithNum.toLowerCase().includes(poiName.toLowerCase())) {
    parts.push(poiName);
  }
  if (roadWithNum) parts.push(roadWithNum);
  if (
    residential &&
    !parts.some((p) => p.toLowerCase().includes(residential.toLowerCase()))
  ) {
    parts.push(residential);
  }
  if (
    hood &&
    !parts.some((p) => p.toLowerCase() === hood.toLowerCase())
  ) {
    parts.push(hood);
  }
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

interface OverpassElement {
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: {
    name?: string;
    highway?: string;
    landuse?: string;
    shop?: string;
    amenity?: string;
    leisure?: string;
    tourism?: string;
    building?: string;
    'addr:street'?: string;
    'addr:housenumber'?: string;
    'addr:suburb'?: string;
    'addr:city'?: string;
  };
}

function classifyOverpassType(tags: NonNullable<OverpassElement['tags']>): string {
  if (tags.amenity) {
    if (['hospital', 'clinic', 'pharmacy'].includes(tags.amenity)) return 'Saúde';
    return 'Ponto comercial';
  }
  if (tags.shop || tags.building === 'commercial' || tags.building === 'retail') {
    return 'Comércio';
  }
  if (tags.leisure) return 'Parque / Praça';
  if (tags.tourism) return 'Referência';
  return 'Local';
}

interface LocalGeoIndexItem {
  name: string;
  street?: string;
  hood?: string;
  city?: string;
  categoryLabel: string;
  isPoi: boolean;
  lat: number;
  lng: number;
  searchNorm: string;
}

const LOCAL_INDEX_STORAGE_PREFIX = 'mobilidade66_geo_idx_v2_';
const localGeoIndexMap = new Map<string, LocalGeoIndexItem[]>();
const localGeoIndexInFlight = new Map<string, Promise<LocalGeoIndexItem[]>>();

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

function normGeoText(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bii\b/g, '2')
    .replace(/\biii\b/g, '3')
    .replace(/\biv\b/g, '4')
    .replace(/\bav\.?\b/g, 'avenida')
    .replace(/\br\.?\b/g, 'rua')
    .replace(/\bres\.?\b/g, 'residencial')
    .replace(/\bjd\.?\b/g, 'jardim')
    .replace(/\bpq\.?\b/g, 'parque')
    .replace(/\btv\.?\b/g, 'travessa')
    .replace(/\bp[cç]\.?\b/g, 'praca')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function queryOverpassJson(
  overpassQuery: string,
  signal?: AbortSignal
): Promise<{ elements?: OverpassElement[] } | null> {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 5500);
      const onParentAbort = () => controller.abort();
      signal?.addEventListener('abort', onParentAbort, { once: true });

      const res = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        body: `data=${encodeURIComponent(overpassQuery)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      window.clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onParentAbort);
      if (res.ok) {
        return (await res.json()) as { elements?: OverpassElement[] };
      }
    } catch {
      if (signal?.aborted) return null;
      // Try next Overpass mirror
    }
  }
  return null;
}

export async function preloadLocalGeoIndex(
  lat: number,
  lng: number
): Promise<void> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  if (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) return;

  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (localGeoIndexMap.has(key)) return;

  // Hydrate from localStorage immediately if fresh (< 24h)
  try {
    const raw = localStorage.getItem(`${LOCAL_INDEX_STORAGE_PREFIX}${key}`);
    if (raw) {
      const parsed = JSON.parse(raw) as { ts?: number; items?: LocalGeoIndexItem[] };
      if (
        parsed.ts &&
        Date.now() - parsed.ts < 86_400_000 &&
        Array.isArray(parsed.items) &&
        parsed.items.length > 0
      ) {
        localGeoIndexMap.set(key, parsed.items);
        return;
      }
    }
  } catch {
    // Ignore storage read failure
  }

  if (localGeoIndexInFlight.has(key)) {
    await localGeoIndexInFlight.get(key);
    return;
  }

  const job = (async (): Promise<LocalGeoIndexItem[]> => {
    const localCity = await resolveCachedLocalCity(lat, lng).catch(() => '');
    const overpassStreetsAndHoods = `[out:json][timeout:10];(
      node(around:15000,${lat},${lng})["name"]["place"];
      way(around:15000,${lat},${lng})["name"]["place"];
      relation(around:15000,${lat},${lng})["name"]["place"];
      way(around:15000,${lat},${lng})["name"]["landuse"~"residential|commercial|retail|industrial"];
      way(around:15000,${lat},${lng})["highway"]["name"];
    );out center 1200;`;

    const overpassPois = `[out:json][timeout:10];(
      node(around:15000,${lat},${lng})["name"]["shop"];
      way(around:15000,${lat},${lng})["name"]["shop"];
      node(around:15000,${lat},${lng})["name"]["amenity"];
      way(around:15000,${lat},${lng})["name"]["amenity"];
      node(around:15000,${lat},${lng})["name"]["healthcare"];
      way(around:15000,${lat},${lng})["name"]["healthcare"];
      node(around:15000,${lat},${lng})["name"]["office"];
      way(around:15000,${lat},${lng})["name"]["office"];
      node(around:15000,${lat},${lng})["name"]["tourism"];
      way(around:15000,${lat},${lng})["name"]["tourism"];
      node(around:15000,${lat},${lng})["name"]["leisure"];
      way(around:15000,${lat},${lng})["name"]["leisure"];
      node(around:15000,${lat},${lng})["name"]["craft"];
      node(around:15000,${lat},${lng})["name"]["sport"];
      node(around:15000,${lat},${lng})["name"]["historic"];
      node(around:15000,${lat},${lng})["name"]["public_transport"];
      way(around:15000,${lat},${lng})["name"]["building"];
    );out center 1200;`;

    const [streetsData, poisData] = await Promise.all([
      queryOverpassJson(overpassStreetsAndHoods),
      queryOverpassJson(overpassPois),
    ]);
    const combinedElements = [
      ...(poisData?.elements || []),
      ...(streetsData?.elements || []),
    ];
    if (!combinedElements.length) return [];

    const dedup = new Set<string>();
    const items: LocalGeoIndexItem[] = [];

    for (const el of combinedElements) {
      const elLat = el.lat ?? el.center?.lat;
      const elLng = el.lon ?? el.center?.lon;
      const rawName = el.tags?.name?.trim();
      if (!rawName || typeof elLat !== 'number' || typeof elLng !== 'number') continue;

      const tags = el.tags || {};
      const street = tags['addr:street']
        ? `${tags['addr:street']}${tags['addr:housenumber'] ? `, ${tags['addr:housenumber']}` : ''}`
        : '';
      const hood = tags['addr:suburb'] || '';
      const city = tags['addr:city'] || localCity;

      const dedupeKey = `${rawName.toLowerCase()}|${elLat.toFixed(3)}|${elLng.toFixed(3)}`;
      if (dedup.has(dedupeKey)) continue;
      dedup.add(dedupeKey);

      const tagsRec = tags as Record<string, string | undefined>;
      const isRoad = Boolean(tagsRec.highway && !tags.shop && !tags.amenity && !tags.leisure);
      const isNeighborhood = Boolean(
        tagsRec.place || ['residential', 'commercial', 'retail', 'industrial'].includes(tagsRec.landuse || '')
      );
      const categoryLabel = isRoad
        ? 'Rua / Av.'
        : isNeighborhood
        ? 'Bairro / Cond.'
        : classifyOverpassType(tags);
      const isPoi = !isRoad;

      items.push({
        name: rawName,
        street: street || undefined,
        hood: hood || undefined,
        city: city || undefined,
        categoryLabel,
        isPoi,
        lat: elLat,
        lng: elLng,
        searchNorm: normGeoText([rawName, street, hood, city].filter(Boolean).join(' ')),
      });
    }

    if (items.length > 0) {
      localGeoIndexMap.set(key, items);
      try {
        localStorage.setItem(
          `${LOCAL_INDEX_STORAGE_PREFIX}${key}`,
          JSON.stringify({ ts: Date.now(), items: items.slice(0, 1500) })
        );
      } catch {
        // Ignore storage quota
      }
    }
    return items;
  })();

  localGeoIndexInFlight.set(key, job);
  try {
    await job;
  } finally {
    localGeoIndexInFlight.delete(key);
  }
}

export function searchLocalGeoIndex(
  query: string,
  nearLat?: number,
  nearLng?: number
): AddressSuggestion[] {
  const raw = query.trim();
  if (!raw) return [];

  const hasLocalCoords =
    typeof nearLat === 'number' &&
    typeof nearLng === 'number' &&
    Number.isFinite(nearLat) &&
    Number.isFinite(nearLng) &&
    !(Math.abs(nearLat) < 0.01 && Math.abs(nearLng) < 0.01);

  const { compact, houseNumber } = normalizeSearchQuery(raw);
  const queryNorm = normGeoText(compact || raw);
  if (!queryNorm) return [];

  const queryTokens = queryNorm
    .split(/\s+/)
    .filter((t) => t.length >= 1 && !['rua', 'avenida', 'bairro', 'de', 'da', 'do'].includes(t));

  const pool: Array<{ item: LocalGeoIndexItem; score: number; distKm: number }> = [];

  for (const list of localGeoIndexMap.values()) {
    for (const item of list) {
      const nameNorm = normGeoText(item.name);
      let score = 0;

      if (queryNorm.length === 1) {
        const startsName = nameNorm.startsWith(queryNorm);
        const startsWord = nameNorm.split(' ').some((w) => w.startsWith(queryNorm));
        if (!startsName && !startsWord) continue;
        score += startsName ? 55 : 35;
      } else {
        if (nameNorm.startsWith(queryNorm)) score += 72;
        else if (nameNorm.includes(queryNorm)) score += 54;
        else if (item.searchNorm.includes(queryNorm)) score += 40;

        let matched = 0;
        for (const tok of queryTokens) {
          if (item.searchNorm.includes(tok)) {
            matched += 1;
            score += nameNorm.includes(tok) ? 20 : 12;
          }
        }
        if (score === 0 && matched === 0) continue;
        if (queryTokens.length > 0 && matched === queryTokens.length) score += 28;
      }

      if (item.isPoi) score += 16;
      const distKm = hasLocalCoords ? haversineKm(nearLat, nearLng, item.lat, item.lng) : 0;
      score -= Math.min(35, distKm * 1.4);

      pool.push({ item, score, distKm });
    }
  }

  pool.sort((a, b) => b.score - a.score || a.distKm - b.distKm);

  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];
  for (const { item, distKm } of pool) {
    const primaryLabel =
      houseNumber && !item.isPoi && !item.name.includes(houseNumber)
        ? `${item.name}, ${houseNumber}`
        : item.name;
    const fullAddress = [primaryLabel, item.street, item.hood, item.city]
      .filter(Boolean)
      .join(' · ');
    const dedupe = fullAddress.toLowerCase();
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    out.push({
      address: fullAddress,
      subtitle: [item.hood, item.city, hasLocalCoords ? `${distKm.toFixed(1)} km` : '']
        .filter(Boolean)
        .join(' · '),
      categoryLabel: item.categoryLabel,
      lat: item.lat,
      lng: item.lng,
    });
    if (out.length >= 10) break;
  }

  return out;
}

const nearbyPlacesCache = new Map<string, AddressSuggestion[]>();

export async function fetchNearbyPopularPlaces(
  lat: number,
  lng: number
): Promise<AddressSuggestion[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const cached = nearbyPlacesCache.get(cacheKey);
  if (cached) return cached;

  try {
    void preloadLocalGeoIndex(lat, lng);
    const localCity = await resolveCachedLocalCity(lat, lng);
    const overpassQuery = `[out:json][timeout:6];(node(around:4500,${lat},${lng})[name]["amenity"~"hospital|clinic|pharmacy|school|university|marketplace|bank|bus_station|fuel"];node(around:4500,${lat},${lng})[name]["shop"~"supermarket|mall|bakery|convenience|department_store"];node(around:4500,${lat},${lng})[name]["leisure"~"park|square|garden"];way(around:4500,${lat},${lng})[name]["shop"~"supermarket|mall|department_store"];way(around:4500,${lat},${lng})[name]["leisure"~"park|square"];);out center 20;`;

    const data = await queryOverpassJson(overpassQuery);
    if (!data) return [];

    const seen = new Set<string>();
    const items: Array<{ s: AddressSuggestion; dist: number }> = [];

    for (const el of data.elements || []) {
      const elLat = el.lat ?? el.center?.lat;
      const elLng = el.lon ?? el.center?.lon;
      const name = el.tags?.name?.trim();
      if (!name || typeof elLat !== 'number' || typeof elLng !== 'number') continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const dist = haversineKm(lat, lng, elLat, elLng);
      const street = el.tags?.['addr:street']
        ? `${el.tags['addr:street']}${el.tags['addr:housenumber'] ? `, ${el.tags['addr:housenumber']}` : ''}`
        : '';
      const hood = el.tags?.['addr:suburb'] || '';
      const cityLabel = el.tags?.['addr:city'] || localCity;
      const fullAddress = [name, street, hood, cityLabel].filter(Boolean).join(' · ');

      items.push({
        dist,
        s: {
          address: fullAddress,
          subtitle: [hood, cityLabel, `${dist.toFixed(1)} km`].filter(Boolean).join(' · '),
          categoryLabel: classifyOverpassType(el.tags || {}),
          lat: elLat,
          lng: elLng,
        },
      });
    }

    items.sort((a, b) => a.dist - b.dist);
    const result = items.slice(0, 8).map((i) => i.s);
    if (result.length > 0) {
      nearbyPlacesCache.set(cacheKey, result);
    }
    return result;
  } catch {
    return [];
  }
}

export async function searchAddresses(
  query: string,
  nearLat?: number,
  nearLng?: number,
  signal?: AbortSignal
): Promise<AddressSuggestion[]> {
  const raw = query.trim();
  if (raw.length < 1) return [];

  const { compact, houseNumber } = normalizeSearchQuery(raw);
  const effectiveQuery = compact.length >= 1 ? compact : raw;

  const hasLocalCoords =
    typeof nearLat === 'number' &&
    typeof nearLng === 'number' &&
    Number.isFinite(nearLat) &&
    Number.isFinite(nearLng) &&
    !(Math.abs(nearLat) < 0.01 && Math.abs(nearLng) < 0.01);

  const biasLat = hasLocalCoords ? nearLat : 0;
  const biasLng = hasLocalCoords ? nearLng : 0;
  const MAX_LOCAL_RADIUS_KM = 95;

  if (hasLocalCoords) {
    void preloadLocalGeoIndex(biasLat, biasLng);
  }

  const localCity = hasLocalCoords ? await resolveCachedLocalCity(biasLat, biasLng) : '';
  const queryNorm = normGeoText(effectiveQuery);
  const queryTokens = normalizeTokens(effectiveQuery).filter(
    (t) => t !== 'rua' && t !== 'avenida' && t !== 'bairro'
  );

  interface RankedSuggestion {
    entry: AddressSuggestion;
    distKm: number;
    score: number;
  }

  const localPool: RankedSuggestion[] = [];
  const widePool: RankedSuggestion[] = [];
  const seen = new Set<string>();

  const pushCandidate = (
    entry: AddressSuggestion,
    lat: number,
    lng: number,
    isCommercialPoi: boolean,
    hasExactNumber: boolean,
    sourceBoost = 0
  ) => {
    const dedupeKey = `${entry.address.toLowerCase()}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const distKm = hasLocalCoords ? haversineKm(biasLat, biasLng, lat, lng) : 0;
    const primaryNorm = normGeoText(entry.address.split('·')[0] || entry.address);
    const haystack = normGeoText(`${entry.address} ${entry.subtitle}`);

    let score = sourceBoost;
    if (primaryNorm.startsWith(queryNorm)) score += 62;
    else if (haystack.includes(queryNorm)) score += 48;

    let matchedTokens = 0;
    for (const tok of queryTokens) {
      if (haystack.includes(tok)) {
        matchedTokens += 1;
        score += 18;
      }
    }
    if (queryTokens.length > 0 && matchedTokens === queryTokens.length) {
      score += 28;
    }
    if (isCommercialPoi) score += 24;
    if (houseNumber && (hasExactNumber || haystack.includes(houseNumber))) score += 22;
    if (localCity && haystack.includes(normGeoText(localCity))) {
      score += 36;
    }
    if (hasLocalCoords) {
      score -= Math.min(50, distKm * 1.25);
    }

    const ranked: RankedSuggestion = { entry, distKm, score };
    if (!hasLocalCoords || distKm <= MAX_LOCAL_RADIUS_KM) {
      localPool.push(ranked);
    } else {
      widePool.push(ranked);
    }
  };

  // Seed instantly with local OSM pre-indexed results
  for (const localMatch of searchLocalGeoIndex(effectiveQuery, nearLat, nearLng)) {
    const isPoi = !['Rua / Av.', 'Local'].includes(localMatch.categoryLabel);
    pushCandidate(localMatch, localMatch.lat, localMatch.lng, isPoi, Boolean(houseNumber), 12);
  }

  const runPhoton = async (qText: string, useStrictBbox: boolean) => {
    const params = new URLSearchParams({
      q: qText,
      limit: '20',
    });
    if (hasLocalCoords) {
      params.set('lat', String(biasLat));
      params.set('lon', String(biasLng));
      params.set('location_bias_scale', useStrictBbox ? '0.08' : '0.22');
      if (useStrictBbox) {
        const delta = 0.45;
        params.set(
          'bbox',
          `${biasLng - delta},${biasLat - delta},${biasLng + delta},${biasLat + delta}`
        );
      }
    }

    const res = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return;

    const json = (await res.json()) as { features?: PhotonFeature[] };
    for (const feat of json.features || []) {
      const props = feat.properties;
      const coords = feat.geometry?.coordinates;
      if (!props || !coords || coords.length < 2) continue;
      if (props.countrycode && props.countrycode.toUpperCase() !== 'BR') continue;

      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const formatted = formatPhotonAddress(props, effectiveQuery);
      const city = (props.city || props.county || '').trim();
      const district = (props.district || props.locality || '').trim();
      const distKm = hasLocalCoords ? haversineKm(biasLat, biasLng, lat, lng) : 0;
      const distTag = hasLocalCoords ? `${distKm.toFixed(1)} km` : '';
      const subtitle = [district, city, props.state, distTag].filter(Boolean).join(' · ');
      const catLabel = classifyPhotonType(props);
      const isPoi = ['Comércio', 'Ponto comercial', 'Saúde', 'Parque / Praça', 'Referência'].includes(
        catLabel
      );

      pushCandidate(
        {
          address: formatted,
          subtitle: subtitle || formatted,
          categoryLabel: catLabel,
          lat,
          lng,
        },
        lat,
        lng,
        isPoi,
        Boolean(props.housenumber)
      );
    }
  };

  const runNominatim = async (qText: string, bounded: boolean) => {
    const params = new URLSearchParams({
      q: qText,
      format: 'jsonv2',
      addressdetails: '1',
      namedetails: '1',
      extratags: '1',
      limit: '15',
      countrycodes: 'br',
      'accept-language': 'pt-BR',
    });

    if (hasLocalCoords) {
      const delta = bounded ? 0.38 : 0.9;
      params.set(
        'viewbox',
        `${biasLng - delta},${biasLat + delta},${biasLng + delta},${biasLat - delta}`
      );
      if (bounded) params.set('bounded', '1');
    }

    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      signal,
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    });
    if (!res.ok) return;

    const data = (await res.json()) as NominatimResult[];
    for (const item of data) {
      const lat = parseFloat(item.lat);
      const lng = parseFloat(item.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const formatted = formatShortAddress(item, effectiveQuery);
      const city =
        item.address?.city ||
        item.address?.town ||
        item.address?.municipality ||
        item.address?.village ||
        '';
      const hood = item.address?.neighbourhood || item.address?.suburb || '';
      const distKm = hasLocalCoords ? haversineKm(biasLat, biasLng, lat, lng) : 0;
      const distTag = hasLocalCoords ? `${distKm.toFixed(1)} km` : '';
      const subtitle =
        [hood, city, item.address?.state, distTag].filter(Boolean).join(' · ') ||
        item.display_name;
      const catLabel = classifyNominatimType(item);
      const isPoi = ['Comércio', 'Ponto comercial', 'Saúde', 'Parque / Praça', 'Referência'].includes(
        catLabel
      );

      pushCandidate(
        {
          address: formatted,
          subtitle,
          categoryLabel: catLabel,
          lat,
          lng,
        },
        lat,
        lng,
        isPoi,
        Boolean(item.address?.house_number)
      );
    }
  };

  const runOverpassLocalPois = async (qText: string) => {
    if (!hasLocalCoords) return;
    const words = qText
      .replace(/[^a-zA-Z0-9À-ÿ\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((w) => w.length >= 2);
    const safeToken = words.slice(0, 3).join('.*');
    const strippedWords = words.filter(
      (w) =>
        !/^(residencial|condominio|condomínio|loteamento|rua|avenida|travessa|bairro|conjunto|parque|jardim)$/i.test(
          w
        )
    );
    const strippedToken =
      strippedWords.length > 0 && strippedWords.length < words.length
        ? strippedWords.slice(0, 3).join('.*')
        : '';
    if (!safeToken || safeToken.length < 2) return;

    const filterClause = strippedToken
      ? `["name"~"${safeToken}|${strippedToken}",i]`
      : `["name"~"${safeToken}",i]`;

    const overpassQuery = `[out:json][timeout:6];(node(around:22000,${biasLat},${biasLng})${filterClause};way(around:22000,${biasLat},${biasLng})${filterClause};);out center 25;`;
    const data = await queryOverpassJson(overpassQuery, signal);
    if (!data) return;

    for (const el of data.elements || []) {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      const name = el.tags?.name?.trim();
      if (!name || typeof lat !== 'number' || typeof lng !== 'number') continue;

      const street = el.tags?.['addr:street']
        ? `${el.tags['addr:street']}${el.tags['addr:housenumber'] ? `, ${el.tags['addr:housenumber']}` : ''}`
        : '';
      const hood = el.tags?.['addr:suburb'] || '';
      const city = el.tags?.['addr:city'] || localCity;
      const distKm = haversineKm(biasLat, biasLng, lat, lng);
      const formatted = [name, street, hood, city].filter(Boolean).join(' · ');
      const subtitle = [hood, city, `${distKm.toFixed(1)} km`].filter(Boolean).join(' · ');

      pushCandidate(
        {
          address: formatted,
          subtitle: subtitle || formatted,
          categoryLabel: classifyOverpassType(el.tags || {}),
          lat,
          lng,
        },
        lat,
        lng,
        true,
        Boolean(el.tags?.['addr:housenumber']),
        10
      );
    }
  };

  const cityNorm = normGeoText(localCity);
  const includesLocalCity = Boolean(cityNorm && queryNorm.includes(cityNorm));
  const cityBoostQuery =
    localCity && !includesLocalCity ? `${effectiveQuery} ${localCity}` : effectiveQuery;

  const tasks: Promise<void>[] = [
    runPhoton(effectiveQuery, hasLocalCoords),
    runPhoton(cityBoostQuery, false),
  ];

  if (effectiveQuery.length >= 2) {
    tasks.push(runNominatim(effectiveQuery, hasLocalCoords));
    if (hasLocalCoords) {
      tasks.push(runOverpassLocalPois(effectiveQuery));
    }
    if (localCity && !includesLocalCity) {
      tasks.push(runNominatim(cityBoostQuery, hasLocalCoords));
    }
  }

  try {
    await Promise.allSettled(tasks);
    if (signal?.aborted) return [];
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return [];
  }

  const finalPool = localPool.length > 0 ? localPool : widePool;
  finalPool.sort((a, b) => b.score - a.score || a.distKm - b.distKm);

  return finalPool.slice(0, 18).map((item) => item.entry);
}

interface MelissaGeocodeRawItem {
  name?: string;
  street?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  categoryLabel?: string;
  lat?: number | null;
  lng?: number | null;
}

export async function searchAddressesWithMelissaAI(
  query: string,
  nearLat?: number,
  nearLng?: number,
  cityHint?: string,
  signal?: AbortSignal
): Promise<AddressSuggestion[]> {
  const cleanQuery = query.trim();
  if (cleanQuery.length < 2) return [];

  const hasLocalCoords =
    typeof nearLat === 'number' &&
    typeof nearLng === 'number' &&
    Number.isFinite(nearLat) &&
    Number.isFinite(nearLng) &&
    !(Math.abs(nearLat) < 0.01 && Math.abs(nearLng) < 0.01);

  const localCity =
    cityHint?.trim() ||
    (hasLocalCoords ? await resolveCachedLocalCity(nearLat, nearLng).catch(() => '') : '');

  try {
    const res = await fetch('/api/melissa/geocode', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: cleanQuery,
        lat: hasLocalCoords ? nearLat : undefined,
        lng: hasLocalCoords ? nearLng : undefined,
        city: localCity || undefined,
      }),
    });
    if (!res.ok) return [];

    const data = (await res.json()) as { ok?: boolean; results?: MelissaGeocodeRawItem[] };
    const rawList = Array.isArray(data.results) ? data.results : [];
    if (rawList.length === 0) return [];

    const resolved: AddressSuggestion[] = [];
    for (const item of rawList) {
      if (signal?.aborted) break;
      const name = String(item.name || '').trim();
      if (!name) continue;

      const street = String(item.street || '').trim();
      const hood = String(item.neighborhood || '').trim();
      const city = String(item.city || localCity || '').trim();
      const state = String(item.state || '').trim();

      let lat = typeof item.lat === 'number' && Number.isFinite(item.lat) ? item.lat : NaN;
      let lng = typeof item.lng === 'number' && Number.isFinite(item.lng) ? item.lng : NaN;

      // Refine coordinates via Nominatim street search if missing or out of local bounds
      const needsRefine =
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        (Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01) ||
        (hasLocalCoords && haversineKm(nearLat, nearLng, lat, lng) > 250);

      if (needsRefine && (street || name)) {
        try {
          const lookupText = [street || name, hood, city, state, 'Brasil']
            .filter(Boolean)
            .join(', ');
          const params = new URLSearchParams({
            q: lookupText,
            format: 'jsonv2',
            limit: '1',
            countrycodes: 'br',
          });
          if (hasLocalCoords) {
            const delta = 0.6;
            params.set(
              'viewbox',
              `${nearLng - delta},${nearLat + delta},${nearLng + delta},${nearLat - delta}`
            );
          }
          const nomRes = await fetch(
            `https://nominatim.openstreetmap.org/search?${params.toString()}`,
            { signal, headers: { Accept: 'application/json' } }
          );
          if (nomRes.ok) {
            const nomJson = (await nomRes.json()) as NominatimResult[];
            if (nomJson[0]) {
              const nLat = parseFloat(nomJson[0].lat);
              const nLng = parseFloat(nomJson[0].lon);
              if (Number.isFinite(nLat) && Number.isFinite(nLng)) {
                lat = nLat;
                lng = nLng;
              }
            }
          }
        } catch {
          // Keep AI coordinates or fallback
        }
      }

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        if (hasLocalCoords) {
          lat = nearLat;
          lng = nearLng;
        } else {
          continue;
        }
      }

      const cityState = city ? (state ? `${city} - ${state}` : city) : state;
      const address = [name, street, hood, cityState].filter(Boolean).join(' · ');
      const distTag = hasLocalCoords
        ? `${haversineKm(nearLat, nearLng, lat, lng).toFixed(1)} km`
        : '';
      const subtitle = [street, hood, cityState, distTag].filter(Boolean).join(' · ');

      resolved.push({
        address,
        subtitle: subtitle || address,
        categoryLabel: item.categoryLabel || 'Melissa IA',
        lat,
        lng,
        isAiSuggestion: true,
      });
    }

    return resolved;
  } catch {
    return [];
  }
}

const nearbyPickupCandidatesCache = new Map<string, AddressSuggestion[]>();

export async function fetchNearbyPickupCandidates(
  lat: number,
  lng: number
): Promise<AddressSuggestion[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = nearbyPickupCandidatesCache.get(cacheKey);
  if (cached) return cached;

  const candidates: Array<{ item: AddressSuggestion; distKm: number }> = [];
  const seen = new Set<string>();

  const addCandidate = (
    name: string,
    street: string,
    hood: string,
    city: string,
    catLabel: string,
    cLat: number,
    cLng: number
  ) => {
    const cleanName = name.trim();
    if (!cleanName) return;
    const distKm = haversineKm(lat, lng, cLat, cLng);
    if (distKm > 0.22) return;
    const dedupe = cleanName.toLowerCase();
    if (seen.has(dedupe)) return;
    seen.add(dedupe);

    const distMeters = Math.max(5, Math.round(distKm * 1000));
    const address = [cleanName, street, hood, city].filter(Boolean).join(' · ');
    const subtitle = [street, hood, `${distMeters}m de você`].filter(Boolean).join(' · ');

    candidates.push({
      distKm,
      item: {
        address,
        subtitle: subtitle || `${distMeters}m de você`,
        categoryLabel: catLabel,
        lat: cLat,
        lng: cLng,
      },
    });
  };

  for (const list of localGeoIndexMap.values()) {
    for (const entry of list) {
      const distKm = haversineKm(lat, lng, entry.lat, entry.lng);
      if (distKm <= 0.2) {
        addCandidate(
          entry.name,
          entry.street || '',
          entry.hood || '',
          entry.city || '',
          entry.categoryLabel,
          entry.lat,
          entry.lng
        );
      }
    }
  }

  try {
    const localCity = await resolveCachedLocalCity(lat, lng);
    const overpassQuery = `[out:json][timeout:5];(node(around:180,${lat},${lng})[name];way(around:180,${lat},${lng})[name]["amenity"];way(around:180,${lat},${lng})[name]["shop"];way(around:180,${lat},${lng})[name]["building"];way(around:180,${lat},${lng})[name]["landuse"="residential"];);out center 20;`;
    const data = await queryOverpassJson(overpassQuery);
    for (const el of data?.elements || []) {
      const elLat = el.lat ?? el.center?.lat;
      const elLng = el.lon ?? el.center?.lon;
      const name = el.tags?.name?.trim();
      if (!name || typeof elLat !== 'number' || typeof elLng !== 'number') continue;
      if (el.tags?.highway && !el.tags?.amenity && !el.tags?.shop && !el.tags?.building) continue;
      const street = el.tags?.['addr:street']
        ? `${el.tags['addr:street']}${el.tags['addr:housenumber'] ? `, ${el.tags['addr:housenumber']}` : ''}`
        : '';
      const hood = el.tags?.['addr:suburb'] || '';
      const city = el.tags?.['addr:city'] || localCity;
      addCandidate(
        name,
        street,
        hood,
        city,
        classifyOverpassType(el.tags || {}),
        elLat,
        elLng
      );
    }
  } catch {
    // Ignore Overpass rate limit and keep local index candidates
  }

  candidates.sort((a, b) => a.distKm - b.distKm);
  const finalList = candidates.slice(0, 6).map((c) => c.item);
  if (finalList.length > 0) {
    nearbyPickupCandidatesCache.set(cacheKey, finalList);
  }
  return finalList;
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const [nomRes, nearbyPois] = await Promise.all([
      fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&extratags=1&namedetails=1&accept-language=pt-BR`,
        { headers: { Accept: 'application/json' } }
      ),
      fetchNearbyPickupCandidates(lat, lng).catch(() => []),
    ]);

    let baseAddress = '';
    if (nomRes.ok) {
      const data = (await nomRes.json()) as NominatimResult;
      baseAddress = formatShortAddress(data);
    }

    const closestPoi = nearbyPois.find(
      (p) => haversineKm(lat, lng, p.lat, p.lng) <= 0.055
    );
    if (closestPoi) {
      const poiTitle = closestPoi.address.split('·')[0].trim();
      if (poiTitle && !baseAddress.toLowerCase().includes(poiTitle.toLowerCase())) {
        return baseAddress ? `${poiTitle} · ${baseAddress}` : closestPoi.address;
      }
    }

    return baseAddress || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
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
  const cleanName = (stripDiacritics(receiverName) || 'BOREAL MOBILIDADE').slice(0, 25).toUpperCase();
  const cleanCity = (stripDiacritics(city.split(',')[0].split('-')[0]) || 'BRASIL')
    .trim()
    .slice(0, 15)
    .toUpperCase();
  const cleanTx = txId.replace(/[^A-Za-z0-9]/g, '').slice(-8).toUpperCase() || 'BOREAL';

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
