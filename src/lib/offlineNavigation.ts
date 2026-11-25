import L from 'leaflet';
import type { RouteStep } from './geo';

const TILE_DB_NAME = 'meia66_offline_maps';
const TILE_STORE_NAME = 'osm_tiles';
const TILE_DB_VERSION = 1;
const MAX_CACHED_TILES = 1800;
const ACTIVE_ROUTE_CACHE_KEY = 'meia66_active_route_cache_v1';

interface CachedTileRecord {
  key: string;
  blob: Blob;
  ts: number;
}

export interface OfflineActiveRouteCache {
  rideId: string;
  stage: 'A' | 'B' | 'searching' | 'preview';
  routeCoords: [number, number][];
  routeSteps: RouteStep[];
  distanceKm: number;
  durationMin: number;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openTileDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(TILE_DB_NAME, TILE_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(TILE_STORE_NAME)) {
          const store = db.createObjectStore(TILE_STORE_NAME, { keyPath: 'key' });
          store.createIndex('ts', 'ts', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

async function getCachedTileBlob(key: string): Promise<Blob | null> {
  const db = await openTileDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(TILE_STORE_NAME, 'readonly');
      const store = tx.objectStore(TILE_STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => {
        const rec = req.result as CachedTileRecord | undefined;
        resolve(rec?.blob ?? null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function saveCachedTileBlob(key: string, blob: Blob): Promise<void> {
  const db = await openTileDb();
  if (!db) return;
  try {
    const tx = db.transaction(TILE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(TILE_STORE_NAME);
    store.put({ key, blob, ts: Date.now() } satisfies CachedTileRecord);

    // Occasional lightweight LRU pruning
    if (Math.random() < 0.04) {
      const countReq = store.count();
      countReq.onsuccess = () => {
        const total = countReq.result;
        if (total > MAX_CACHED_TILES) {
          const toDelete = total - MAX_CACHED_TILES + 120;
          const idx = store.index('ts');
          let removed = 0;
          idx.openCursor().onsuccess = (ev) => {
            const cursor = (ev.target as IDBRequest<IDBCursorWithValue | null>).result;
            if (cursor && removed < toDelete) {
              cursor.delete();
              removed++;
              cursor.continue();
            }
          };
        }
      };
    }
  } catch {
    // Ignore IDB quota/lock errors
  }
}

function getOfflinePlaceholderDataUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <rect width="256" height="256" fill="#F4F6F9"/>
    <path d="M0 64H256M0 128H256M0 192H256M64 0V256M128 0V256M192 0V256" stroke="#E2E8F0" stroke-width="1"/>
    <text x="128" y="132" text-anchor="middle" fill="#64748B" font-family="sans-serif" font-size="11" font-weight="600">GO DRIVER MAPA OFFLINE</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const OFFLINE_TILE_PLACEHOLDER = getOfflinePlaceholderDataUrl();

export function createOfflineCachedTileLayer(): L.TileLayer {
  const CachedLayer = L.TileLayer.extend({
    createTile(coords: L.Coords, done: L.DoneCallback) {
      const tile = document.createElement('img');
      tile.alt = '';
      tile.setAttribute('role', 'presentation');
      tile.crossOrigin = 'anonymous';

      const tileUrl = this.getTileUrl(coords);
      const cacheKey = `${coords.z}/${coords.x}/${coords.y}`;
      let objectUrl: string | null = null;

      const assignBlob = (blob: Blob) => {
        objectUrl = URL.createObjectURL(blob);
        tile.onload = () => {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          done(undefined, tile);
        };
        tile.onerror = () => {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          tile.src = OFFLINE_TILE_PLACEHOLDER;
          done(undefined, tile);
        };
        tile.src = objectUrl;
      };

      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

      if (isOffline) {
        getCachedTileBlob(cacheKey).then((blob) => {
          if (blob) {
            assignBlob(blob);
          } else {
            tile.onload = () => done(undefined, tile);
            tile.src = OFFLINE_TILE_PLACEHOLDER;
          }
        });
        return tile;
      }

      fetch(tileUrl, { mode: 'cors' })
        .then(async (res) => {
          if (!res.ok) throw new Error('Tile HTTP error');
          const blob = await res.blob();
          void saveCachedTileBlob(cacheKey, blob);
          assignBlob(blob);
        })
        .catch(async () => {
          const cached = await getCachedTileBlob(cacheKey);
          if (cached) {
            assignBlob(cached);
            return;
          }
          // Fallback to regular img loading (e.g. Service Worker or browser cache)
          tile.onload = () => done(undefined, tile);
          tile.onerror = () => {
            tile.src = OFFLINE_TILE_PLACEHOLDER;
            done(undefined, tile);
          };
          tile.src = tileUrl;
        });

      return tile;
    },
  });

  const LayerConstructor = CachedLayer as unknown as new (
    urlTemplate: string,
    options?: L.TileLayerOptions
  ) => L.TileLayer;

  return new LayerConstructor('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxNativeZoom: 19,
    maxZoom: 21,
    detectRetina: true,
    keepBuffer: 4,
  });
}

function latLngToTileXY(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { x, y };
}

/**
 * Pré-carrega em segundo plano os quadrantes do mapa ao longo da rota ativa no IndexedDB
 * para que a navegação continue visível se o sinal 4G cair no meio do trajeto.
 */
export async function prefetchRouteCorridorTiles(
  coords: [number, number][],
  zoomLevels: number[] = [14, 15, 16]
): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (!coords || coords.length === 0) return;

  const keys = new Set<string>();
  const sampleStep = Math.max(1, Math.floor(coords.length / 18));
  const subdomains = ['a', 'b', 'c'];

  for (let i = 0; i < coords.length; i += sampleStep) {
    const [lat, lng] = coords[i];
    for (const z of zoomLevels) {
      const center = latLngToTileXY(lat, lng, z);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const x = center.x + dx;
          const y = center.y + dy;
          if (x >= 0 && y >= 0) {
            keys.add(`${z}/${x}/${y}`);
          }
          if (keys.size >= 85) break;
        }
        if (keys.size >= 85) break;
      }
      if (keys.size >= 85) break;
    }
    if (keys.size >= 85) break;
  }

  let subIdx = 0;
  for (const key of keys) {
    const existing = await getCachedTileBlob(key);
    if (existing) continue;
    const sub = subdomains[subIdx % subdomains.length];
    subIdx++;
    try {
      const res = await fetch(`https://${sub}.tile.openstreetmap.org/${key}.png`, { mode: 'cors' });
      if (res.ok) {
        const blob = await res.blob();
        await saveCachedTileBlob(key, blob);
      }
    } catch {
      // Stop silently on offline/rate error
      break;
    }
  }
}

export function saveOfflineActiveRideCache(payload: OfflineActiveRouteCache): void {
  try {
    localStorage.setItem(ACTIVE_ROUTE_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota issues
  }
}

export function loadOfflineActiveRideCache(
  rideId: string,
  stage?: OfflineActiveRouteCache['stage']
): OfflineActiveRouteCache | null {
  try {
    const raw = localStorage.getItem(ACTIVE_ROUTE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfflineActiveRouteCache;
    if (parsed.rideId !== rideId) return null;
    if (stage && parsed.stage !== stage) return null;
    if (!Array.isArray(parsed.routeCoords) || parsed.routeCoords.length < 2) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearOfflineActiveRideCache(): void {
  try {
    localStorage.removeItem(ACTIVE_ROUTE_CACHE_KEY);
  } catch {
    // Ignore
  }
}
