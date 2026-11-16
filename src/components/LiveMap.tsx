import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import {
  Compass,
  Crosshair,
  Layers,
  Map as MapIcon,
  Minus,
  Moon,
  Mountain,
  Satellite,
  Plus,
} from 'lucide-react';
import { getUserPreferences, saveUserPreferences, subscribeUserPreferences } from '../lib/userPrefs';
import type { GeoPoint, MapLayerMode, UserProfile } from '../types/mobility';

interface LiveMapProps {
  center: [number, number];
  origin?: GeoPoint | null;
  destination?: GeoPoint | null;
  routeCoords?: [number, number][];
  driverPosition?: {
    lat: number;
    lng: number;
    heading?: number;
    vehicleType?: 'car' | 'moto' | 'delivery';
    label?: string;
  } | null;
  nearbyDrivers?: UserProfile[];
  pickOnMapMode?: 'origin' | 'destination' | null;
  onMapPick?: (lat: number, lng: number) => void;
  onRecenter?: () => void;
  layerMode?: MapLayerMode;
  onLayerModeChange?: (mode: MapLayerMode) => void;
  controlsTopClassName?: string;
  followVehicle?: boolean;
  speedKmh?: number;
  showSpeedometer?: boolean;
}

const LAYER_OPTIONS: Array<{
  id: MapLayerMode;
  label: string;
  shortLabel: string;
  desc: string;
}> = [
  { id: 'urban', label: 'Urbano Padrão', shortLabel: 'Urbano', desc: 'Ruas e bairros' },
  { id: 'satellite', label: 'Satélite HD', shortLabel: 'Satélite', desc: 'Esri Crisp + Ruas' },
  { id: 'dark', label: 'Mapa Noturno', shortLabel: 'Noturno', desc: 'CartoDB Dark' },
  { id: 'terrain_traffic', label: 'Relevo & Tráfego', shortLabel: 'Tráfego', desc: 'Topografia + Vias' },
];

function findClosestRouteIndex(
  routeCoords: [number, number][],
  lat: number,
  lng: number
): number {
  if (routeCoords.length === 0) return 0;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let bestIdx = 0;
  let bestDist = Infinity;

  for (let i = 0; i < routeCoords.length; i++) {
    const dLat = routeCoords[i][0] - lat;
    const dLng = (routeCoords[i][1] - lng) * cosLat;
    const distSq = dLat * dLat + dLng * dLng;
    if (distSq < bestDist) {
      bestDist = distSq;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function MapController({
  center,
  routeCoords,
  driverPosition,
  followVehicle,
  hudActive,
  userPanned,
  onUserPanChange,
  recenterNonce,
  pickOnMapMode,
  onMapPick,
  onZoomChange,
}: {
  center: [number, number];
  routeCoords?: [number, number][];
  driverPosition?: LiveMapProps['driverPosition'];
  followVehicle?: boolean;
  hudActive: boolean;
  userPanned: boolean;
  onUserPanChange: (panned: boolean) => void;
  recenterNonce: number;
  pickOnMapMode?: 'origin' | 'destination' | null;
  onMapPick?: (lat: number, lng: number) => void;
  onZoomChange: (zoomFn: { zoomIn: () => void; zoomOut: () => void }) => void;
}) {
  const map = useMap();
  const initialFollowFittedRef = useRef(false);

  useEffect(() => {
    onZoomChange({
      zoomIn: () => map.zoomIn(),
      zoomOut: () => map.zoomOut(),
    });
  }, [map, onZoomChange]);

  useMapEvents({
    click(e) {
      if (pickOnMapMode && onMapPick) {
        onMapPick(e.latlng.lat, e.latlng.lng);
      }
    },
    dragstart() {
      onUserPanChange(true);
    },
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      map.invalidateSize({ animate: false });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [map, hudActive]);

  useEffect(() => {
    if (!followVehicle) {
      initialFollowFittedRef.current = false;
    }
  }, [followVehicle]);

  useEffect(() => {
    if (routeCoords && routeCoords.length >= 2) {
      if (followVehicle && initialFollowFittedRef.current) return;
      const bounds = L.latLngBounds(routeCoords.map(([lat, lng]) => L.latLng(lat, lng)));
      map.fitBounds(bounds, { padding: [70, 70], maxZoom: 16 });
      if (followVehicle) {
        initialFollowFittedRef.current = true;
      }
    }
  }, [map, routeCoords, followVehicle]);

  useEffect(() => {
    if (!followVehicle || !driverPosition || userPanned) return;
    const targetZoom = Math.max(map.getZoom(), 16);
    map.setView([driverPosition.lat, driverPosition.lng], targetZoom, { animate: true });
  }, [map, followVehicle, driverPosition?.lat, driverPosition?.lng, userPanned, recenterNonce]);

  useEffect(() => {
    if (!followVehicle && (!routeCoords || routeCoords.length < 2)) {
      map.setView(center, map.getZoom(), { animate: true });
    }
  }, [map, center, routeCoords, followVehicle]);

  return null;
}

export const LiveMap: React.FC<LiveMapProps> = ({
  center,
  origin,
  destination,
  routeCoords,
  driverPosition,
  nearbyDrivers = [],
  pickOnMapMode,
  onMapPick,
  onRecenter,
  layerMode: controlledLayerMode,
  onLayerModeChange,
  controlsTopClassName = 'top-24',
  followVehicle = false,
  speedKmh = 0,
  showSpeedometer = false,
}) => {
  const [internalLayerMode, setInternalLayerMode] = useState<MapLayerMode>(
    () => getUserPreferences().map_layer || 'urban'
  );
  const [hudCompassEnabled, setHudCompassEnabled] = useState<boolean>(
    () => getUserPreferences().hud_compass_enabled ?? true
  );
  const [layerMenuOpen, setLayerMenuOpen] = useState(false);
  const [userPanned, setUserPanned] = useState(false);
  const [recenterNonce, setRecenterNonce] = useState(0);
  const zoomApiRef = useRef<{ zoomIn: () => void; zoomOut: () => void }>({
    zoomIn: () => {},
    zoomOut: () => {},
  });

  const layerMode = controlledLayerMode ?? internalLayerMode;

  useEffect(() => {
    const unsub = subscribeUserPreferences((prefs) => {
      if (!controlledLayerMode) {
        setInternalLayerMode(prefs.map_layer);
      }
      setHudCompassEnabled(prefs.hud_compass_enabled);
    });
    return unsub;
  }, [controlledLayerMode]);

  useEffect(() => {
    if (!followVehicle) {
      setUserPanned(false);
    }
  }, [followVehicle]);

  const handleSelectLayer = (mode: MapLayerMode) => {
    setInternalLayerMode(mode);
    saveUserPreferences({ map_layer: mode });
    onLayerModeChange?.(mode);
    setLayerMenuOpen(false);
  };

  const handleToggleHudCompass = () => {
    const next = !hudCompassEnabled;
    setHudCompassEnabled(next);
    saveUserPreferences({ hud_compass_enabled: next });
    if (next) {
      setUserPanned(false);
      setRecenterNonce((n) => n + 1);
    }
  };

  const handleRecenterClick = () => {
    setUserPanned(false);
    setRecenterNonce((n) => n + 1);
    onRecenter?.();
  };

  // Smoothly rotate viewport in 1st-person HUD mode during active navigation
  const activeHeading = driverPosition?.heading ?? 0;
  const isHudRotating =
    followVehicle && hudCompassEnabled && !userPanned && typeof driverPosition?.heading === 'number';
  const hudRotationDeg = isHudRotating ? -activeHeading : 0;

  // Split OSRM route into traveled (Gray) and remaining ahead (Blue)
  const { traveledCoords, remainingCoords, trafficZones } = useMemo(() => {
    if (!routeCoords || routeCoords.length < 2) {
      // Decorative simulated local traffic corridors around current center for terrain_traffic layer
      const [cLat, cLng] = center;
      const simulatedZones: Array<{ coords: [number, number][]; color: string }> = [
        {
          coords: [
            [cLat - 0.004, cLng - 0.006],
            [cLat - 0.001, cLng - 0.001],
            [cLat + 0.003, cLng + 0.004],
          ],
          color: '#10B981',
        },
        {
          coords: [
            [cLat + 0.002, cLng - 0.005],
            [cLat, cLng],
            [cLat - 0.002, cLng + 0.005],
          ],
          color: '#F59E0B',
        },
      ];
      return {
        traveledCoords: [] as [number, number][],
        remainingCoords: [] as [number, number][],
        trafficZones: simulatedZones,
      };
    }

    const total = routeCoords.length;
    const midStart = Math.floor(total * 0.42);
    const midEnd = Math.min(total - 1, Math.floor(total * 0.58));
    const heavyStart = Math.floor(total * 0.72);
    const heavyEnd = Math.min(total - 1, Math.floor(total * 0.84));
    const routeZones: Array<{ coords: [number, number][]; color: string }> = [
      { coords: routeCoords.slice(0, Math.max(2, midStart + 1)), color: '#10B981' },
    ];
    if (midEnd > midStart) {
      routeZones.push({ coords: routeCoords.slice(midStart, midEnd + 1), color: '#F59E0B' });
    }
    if (heavyEnd > heavyStart) {
      routeZones.push({ coords: routeCoords.slice(heavyStart, heavyEnd + 1), color: '#EF4444' });
    }

    if (!driverPosition || !followVehicle) {
      return {
        traveledCoords: [] as [number, number][],
        remainingCoords: routeCoords,
        trafficZones: routeZones,
      };
    }
    const closestIdx = findClosestRouteIndex(routeCoords, driverPosition.lat, driverPosition.lng);
    const traveled =
      closestIdx > 0 ? routeCoords.slice(0, closestIdx + 1) : ([] as [number, number][]);
    const tail = routeCoords.slice(closestIdx);
    const remaining: [number, number][] =
      tail.length >= 1
        ? [[driverPosition.lat, driverPosition.lng], ...tail]
        : [
            [driverPosition.lat, driverPosition.lng],
            routeCoords[routeCoords.length - 1],
          ];
    return {
      traveledCoords: traveled,
      remainingCoords: remaining,
      trafficZones: routeZones,
    };
  }, [routeCoords, driverPosition, followVehicle, center]);

  const originIcon = useMemo(
    () =>
      L.divIcon({
        className: '',
        html: `<div style="width:24px;height:24px;border-radius:9999px;background:#2563EB;border:4px solid #ffffff;box-shadow:0 4px 12px rgba(0,0,0,0.4);"></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
    []
  );

  const destinationIcon = useMemo(
    () =>
      L.divIcon({
        className: '',
        html: `<div style="width:28px;height:28px;border-radius:8px;background:#111827;color:#FFCC00;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;border:3px solid #ffffff;box-shadow:0 4px 14px rgba(0,0,0,0.38);">B</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      }),
    []
  );

  const makeVehicleIcon = (
    vehicleType: 'car' | 'moto' | 'delivery' = 'car',
    heading = 0,
    active = true
  ) =>
    L.divIcon({
      className: 'velo-smooth-marker',
      html: `<div style="position:relative;transform:rotate(${heading}deg);width:44px;height:44px;display:flex;align-items:center;justify-content:center;">
        ${
          active
            ? `<div style="position:absolute;top:-5px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:10px solid #FFCC00;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));"></div>`
            : ''
        }
        <div style="width:38px;height:38px;border-radius:9999px;background:${
          active ? '#111827' : '#ffffff'
        };border:3px solid ${active ? '#FFCC00' : '#2563EB'};display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(0,0,0,0.35);">
          ${
            vehicleType === 'moto' || vehicleType === 'delivery'
              ? `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="${
                  active ? '#FFCC00' : '#111827'
                }" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-3 11.5V14l-3-3 4-3 2 3h3"/></svg>`
              : `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="${
                  active ? '#FFCC00' : '#111827'
                }" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`
          }
        </div>
      </div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });

  const activeLayerMeta = LAYER_OPTIONS.find((l) => l.id === layerMode) || LAYER_OPTIONS[0];

  return (
    <div
      className={`relative h-full w-full overflow-hidden ${
        layerMode === 'satellite' ? 'leaflet-satellite-crisp bg-neutral-900' : 'bg-neutral-100 dark:bg-neutral-900'
      }`}
    >
      {/* Rotatable inner map viewport for 1st-Person Compass HUD */}
      <div
        className={
          isHudRotating
            ? 'leaflet-hud-viewport absolute left-1/2 top-1/2 h-[155vmax] w-[155vmax]'
            : 'leaflet-hud-viewport h-full w-full'
        }
        style={
          isHudRotating
            ? { transform: `translate(-50%, -50%) rotate(${hudRotationDeg}deg)` }
            : undefined
        }
      >
        <MapContainer
          center={center}
          zoom={15}
          maxZoom={21}
          dragging={true}
          touchZoom={true}
          scrollWheelZoom={true}
          doubleClickZoom={true}
          zoomControl={false}
          className="h-full w-full"
        >
          {layerMode === 'urban' && (
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxNativeZoom={19}
              maxZoom={21}
              detectRetina={true}
            />
          )}

          {layerMode === 'satellite' && (
            <>
              <TileLayer
                attribution="Tiles &copy; Esri"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                maxNativeZoom={18}
                maxZoom={21}
                detectRetina={true}
              />
              <TileLayer
                attribution="Labels &copy; Esri"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                maxNativeZoom={18}
                maxZoom={21}
              />
            </>
          )}

          {layerMode === 'dark' && (
            <TileLayer
              attribution='&copy; <a href="https://carto.com/">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              maxNativeZoom={19}
              maxZoom={21}
              detectRetina={true}
            />
          )}

          {layerMode === 'terrain_traffic' && (
            <TileLayer
              attribution="Topografia &copy; Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"
              maxNativeZoom={18}
              maxZoom={21}
              detectRetina={true}
            />
          )}

          <MapController
            center={center}
            routeCoords={routeCoords}
            driverPosition={driverPosition}
            followVehicle={followVehicle}
            hudActive={isHudRotating}
            userPanned={userPanned}
            onUserPanChange={setUserPanned}
            recenterNonce={recenterNonce}
            pickOnMapMode={pickOnMapMode}
            onMapPick={onMapPick}
            onZoomChange={(api) => {
              zoomApiRef.current = api;
            }}
          />

          {origin && (
            <Marker position={[origin.lat, origin.lng]} icon={originIcon}>
              <Popup>
                <div className="text-xs font-semibold text-neutral-900">
                  Origem / Embarque: {origin.address}
                </div>
              </Popup>
            </Marker>
          )}

          {destination && (
            <Marker position={[destination.lat, destination.lng]} icon={destinationIcon}>
              <Popup>
                <div className="text-xs font-semibold text-neutral-900">
                  Destino: {destination.address}
                </div>
              </Popup>
            </Marker>
          )}

          {/* Traffic Corridor Indicators when Relevo & Tráfego layer is selected */}
          {layerMode === 'terrain_traffic' &&
            trafficZones.map((zone, idx) => (
              <Polyline
                key={`traffic-${idx}`}
                positions={zone.coords}
                pathOptions={{
                  color: zone.color,
                  weight: 10,
                  opacity: 0.45,
                }}
              />
            ))}

          {/* Traveled Route Portion (Gray) */}
          {traveledCoords.length >= 2 && (
            <Polyline
              positions={traveledCoords}
              pathOptions={{ color: '#9CA3AF', weight: 6.5, opacity: 0.85 }}
            />
          )}

          {/* Remaining Route Ahead (Two-tone Blue) */}
          {remainingCoords.length >= 2 && (
            <>
              <Polyline
                positions={remainingCoords}
                pathOptions={{ color: '#1E3A8A', weight: 8, opacity: 0.9 }}
              />
              <Polyline
                positions={remainingCoords}
                pathOptions={{ color: '#3B82F6', weight: 4.5, opacity: 1 }}
              />
            </>
          )}

          {driverPosition && (
            <Marker
              position={[driverPosition.lat, driverPosition.lng]}
              icon={makeVehicleIcon(driverPosition.vehicleType || 'car', driverPosition.heading || 0, true)}
            >
              {driverPosition.label && (
                <Popup>
                  <div className="text-xs font-bold text-neutral-900">{driverPosition.label}</div>
                </Popup>
              )}
            </Marker>
          )}

          {nearbyDrivers.map((drv) => {
            if (!drv.driver?.current_lat || !drv.driver?.current_lng) return null;
            if (driverPosition && drv.driver.current_lat === driverPosition.lat) return null;
            const statusLabel =
              drv.driver.vehicle_type === 'delivery'
                ? 'Entregador / Motoboy'
                : drv.driver.vehicle_type === 'moto'
                ? 'Moto'
                : 'Carro';
            return (
              <Marker
                key={drv.id}
                position={[drv.driver.current_lat, drv.driver.current_lng]}
                icon={makeVehicleIcon(drv.driver.vehicle_type, drv.driver.heading, false)}
              >
                <Popup>
                  <div className="text-xs font-semibold text-neutral-900 space-y-0.5">
                    <p className="font-bold">{drv.full_name}</p>
                    <p className="text-[11px] text-neutral-600">
                      {statusLabel} · {drv.driver.vehicle_model} ({drv.driver.vehicle_plate})
                    </p>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      {/* Upright Floating Controls (Never rotated with map) */}
      <div className={`pointer-events-auto absolute right-3 ${controlsTopClassName} z-[500] flex flex-col items-end gap-2`}>
        {/* Multi-Layer Picker Trigger */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setLayerMenuOpen((o) => !o)}
            className={`flex h-11 px-3 items-center justify-center gap-1.5 rounded-2xl shadow-lg border text-[11px] font-extrabold active:scale-95 transition ${
              layerMode === 'satellite' || layerMode === 'dark'
                ? 'bg-neutral-950 text-[#FFD100] border-neutral-800'
                : 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white border-neutral-200 dark:border-neutral-700'
            }`}
            aria-label="Selecionar camada do mapa"
            title="Camadas de Geoprocessamento"
          >
            {layerMode === 'satellite' ? (
              <Satellite className="h-4 w-4 text-[#FFD100]" />
            ) : layerMode === 'dark' ? (
              <Moon className="h-4 w-4 text-[#FFD100]" />
            ) : layerMode === 'terrain_traffic' ? (
              <Mountain className="h-4 w-4 text-emerald-600" />
            ) : (
              <Layers className="h-4 w-4 text-blue-600" />
            )}
            <span>{activeLayerMeta.shortLabel}</span>
          </button>

          {layerMenuOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow-2xl p-2 space-y-1 z-[520]">
              <p className="px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-neutral-400">
                Camadas do Mapa
              </p>
              {LAYER_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSelectLayer(opt.id)}
                  className={`flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-xs transition ${
                    layerMode === opt.id
                      ? 'bg-neutral-950 text-[#FFD100] font-extrabold'
                      : 'text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 font-bold'
                  }`}
                >
                  <span>{opt.label}</span>
                  <span
                    className={`text-[10px] ${
                      layerMode === opt.id ? 'text-neutral-300' : 'text-neutral-400'
                    }`}
                  >
                    {opt.desc}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 1st-Person Compass HUD Toggle */}
        {followVehicle && (
          <button
            type="button"
            onClick={handleToggleHudCompass}
            className={`flex h-11 px-3 items-center justify-center gap-1.5 rounded-2xl shadow-lg border text-[11px] font-extrabold active:scale-95 transition ${
              hudCompassEnabled
                ? 'bg-blue-600 text-white border-blue-500'
                : 'bg-white dark:bg-neutral-900 text-neutral-700 dark:text-neutral-200 border-neutral-200 dark:border-neutral-700'
            }`}
            aria-label="Alternar bússola HUD 1ª pessoa"
            title="Rotação automática por bússola GPS"
          >
            <Compass
              className="h-4 w-4 transition-transform"
              style={{ transform: `rotate(${activeHeading}deg)` }}
            />
            <span>HUD</span>
          </button>
        )}

        <div className="flex flex-col gap-1.5 items-end">
          <button
            type="button"
            onClick={() => zoomApiRef.current.zoomIn()}
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-lg border border-neutral-200 dark:border-neutral-700 active:scale-95 transition"
            aria-label="Aproximar mapa"
          >
            <Plus className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => zoomApiRef.current.zoomOut()}
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white shadow-lg border border-neutral-200 dark:border-neutral-700 active:scale-95 transition"
            aria-label="Afastar mapa"
          >
            <Minus className="h-5 w-5" />
          </button>
          {onRecenter && (
            <button
              type="button"
              onClick={handleRecenterClick}
              className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#FFCC00] text-neutral-950 shadow-lg active:scale-95 transition"
              aria-label="Centralizar GPS"
              title="Minha localização"
            >
              <Crosshair className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* Real-time Floating GPS Speedometer */}
      {showSpeedometer && (
        <div
          className="pointer-events-none absolute left-3 top-28 z-[500] flex h-[68px] w-[68px] flex-col items-center justify-center rounded-2xl bg-[#14171D] text-white shadow-xl border-2 border-[#FFD100]"
          aria-label={`Velocidade atual ${Math.max(0, Math.round(speedKmh))} quilômetros por hora`}
        >
          <span className="font-mono-num text-2xl font-extrabold leading-none text-[#FFD100]">
            {Math.max(0, Math.round(speedKmh))}
          </span>
          <span className="mt-0.5 text-[10px] font-extrabold uppercase tracking-wider text-neutral-300">
            km/h
          </span>
        </div>
      )}

      {/* Subtle Map Mode Badge Top Left */}
      {!showSpeedometer && (
        <div className="pointer-events-none hidden sm:flex absolute left-3 top-20 z-[450] items-center gap-1.5 rounded-full bg-white dark:bg-neutral-900 px-2.5 py-1 text-[10px] font-bold text-neutral-700 dark:text-neutral-200 shadow border border-neutral-200 dark:border-neutral-700">
          {layerMode === 'satellite' ? (
            <>
              <Satellite className="h-3 w-3 text-amber-600" />
              <span>Satélite HD</span>
            </>
          ) : layerMode === 'dark' ? (
            <>
              <Moon className="h-3 w-3 text-indigo-400" />
              <span>Mapa Noturno</span>
            </>
          ) : layerMode === 'terrain_traffic' ? (
            <>
              <Mountain className="h-3 w-3 text-emerald-600" />
              <span>Relevo & Tráfego</span>
            </>
          ) : (
            <>
              <MapIcon className="h-3 w-3 text-blue-600" />
              <span>Modo Urbano</span>
            </>
          )}
        </div>
      )}
    </div>
  );
};
