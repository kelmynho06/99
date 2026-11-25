import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import {
  Compass,
  Crosshair,
  Map as MapIcon,
  Minus,
  Plus,
  WifiOff,
} from 'lucide-react';
import { useOnlineStatus } from '../hooks/usePWAInstall';
import { useTranslation } from '../lib/i18n';
import {
  createOfflineCachedTileLayer,
  prefetchRouteCorridorTiles,
} from '../lib/offlineNavigation';
import { getUserPreferences, saveUserPreferences, subscribeUserPreferences } from '../lib/userPrefs';
import type { GeoPoint, MapLayerMode, UserProfile } from '../types/mobility';

interface LiveMapProps {
  center: [number, number];
  origin?: GeoPoint | null;
  destination?: GeoPoint | null;
  userLocation?: { lat: number; lng: number } | null;
  isDelivery?: boolean;
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
  enable3dHud?: boolean;
  speedKmh?: number;
  showSpeedometer?: boolean;
}

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

function computeSegmentBearingDeg(a: [number, number], b: [number, number]): number {
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function MapController({
  center,
  routeCoords,
  driverPosition,
  followVehicle,
  enable3dHud,
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
  enable3dHud?: boolean;
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
    const minNavZoom = enable3dHud ? 17.5 : 16;
    const targetZoom = Math.max(map.getZoom(), minNavZoom);
    map.setView([driverPosition.lat, driverPosition.lng], targetZoom, { animate: true });
  }, [map, followVehicle, enable3dHud, driverPosition?.lat, driverPosition?.lng, userPanned, recenterNonce]);

  useEffect(() => {
    if (!followVehicle && (!routeCoords || routeCoords.length < 2)) {
      map.setView(center, map.getZoom(), { animate: true });
    }
  }, [map, center, routeCoords, followVehicle]);

  return null;
}

function OfflineTileLayerController({
  routeCoords,
  isOnline,
}: {
  routeCoords?: [number, number][];
  isOnline: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    const layer = createOfflineCachedTileLayer();
    layer.addTo(map);
    return () => {
      map.removeLayer(layer);
    };
  }, [map]);

  useEffect(() => {
    if (!isOnline || !routeCoords || routeCoords.length < 2) return;
    void prefetchRouteCorridorTiles(routeCoords, [14, 15, 16]);
  }, [isOnline, routeCoords]);

  return null;
}

export const LiveMap: React.FC<LiveMapProps> = ({
  center,
  origin,
  destination,
  userLocation,
  isDelivery = false,
  routeCoords,
  driverPosition,
  nearbyDrivers = [],
  pickOnMapMode,
  onMapPick,
  onRecenter,
  controlsTopClassName = 'top-24',
  followVehicle = false,
  enable3dHud = false,
  speedKmh = 0,
  showSpeedometer = false,
}) => {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  const [hudCompassEnabled, setHudCompassEnabled] = useState<boolean>(
    () => getUserPreferences().hud_compass_enabled ?? true
  );
  const [userPanned, setUserPanned] = useState(false);
  const [recenterNonce, setRecenterNonce] = useState(0);
  const zoomApiRef = useRef<{ zoomIn: () => void; zoomOut: () => void }>({
    zoomIn: () => {},
    zoomOut: () => {},
  });

  useEffect(() => {
    return subscribeUserPreferences((prefs) => {
      setHudCompassEnabled(prefs.hud_compass_enabled);
    });
  }, []);

  useEffect(() => {
    if (!followVehicle) {
      setUserPanned(false);
    }
  }, [followVehicle]);

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
  const { traveledCoords, remainingCoords } = useMemo(() => {
    if (!routeCoords || routeCoords.length < 2) {
      return {
        traveledCoords: [] as [number, number][],
        remainingCoords: [] as [number, number][],
      };
    }

    if (!driverPosition || !followVehicle) {
      return {
        traveledCoords: [] as [number, number][],
        remainingCoords: routeCoords,
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
    };
  }, [routeCoords, driverPosition, followVehicle]);

  // Directional white chevrons along the remaining blue route (matching screenshot)
  const routeChevrons = useMemo(() => {
    if (remainingCoords.length < 4) return [] as Array<{ pos: [number, number]; angle: number }>;
    const count = Math.min(7, Math.max(2, Math.floor(remainingCoords.length / 8)));
    const items: Array<{ pos: [number, number]; angle: number }> = [];
    for (let k = 1; k <= count; k++) {
      const idx = Math.min(
        remainingCoords.length - 2,
        Math.max(1, Math.floor((k * (remainingCoords.length - 1)) / (count + 1)))
      );
      const a = remainingCoords[idx];
      const b = remainingCoords[idx + 1];
      if (!a || !b) continue;
      items.push({
        pos: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
        angle: computeSegmentBearingDeg(a, b),
      });
    }
    return items;
  }, [remainingCoords]);

  // Passenger Live Location Badge ("Eu") in Electric Blue
  const userLocationIcon = useMemo(
    () =>
      L.divIcon({
        className: '',
        html: `<div style="position:relative;width:54px;height:54px;display:flex;align-items:center;justify-content:center;">
          <div style="position:absolute;inset:0;border-radius:9999px;background:rgba(37,99,235,0.18);border:1.5px solid rgba(56,189,248,0.45);"></div>
          <div style="position:relative;width:28px;height:28px;border-radius:9999px;background:#EFF6FF;border:3px solid #ffffff;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(37,99,235,0.38);">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="#2563EB">
              <circle cx="12" cy="8.5" r="4"/>
              <path d="M4.5 20.5c0-4 3.4-6.5 7.5-6.5s7.5 2.5 7.5 6.5z"/>
            </svg>
          </div>
        </div>`,
        iconSize: [54, 54],
        iconAnchor: [27, 27],
      }),
    []
  );

  // Origin / Pickup Marker: Vivid Emerald circle (rides) OR Electric Blue ring (deliveries)
  const originIcon = useMemo(
    () =>
      L.divIcon({
        className: '',
        html: isDelivery
          ? `<div style="position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center;">
              <div style="position:absolute;inset:0;border-radius:9999px;background:rgba(37,99,235,0.22);"></div>
              <div style="position:relative;width:22px;height:22px;border-radius:9999px;background:#ffffff;border:5px solid #2563EB;box-shadow:0 4px 12px rgba(37,99,235,0.28);"></div>
            </div>`
          : `<div style="position:relative;width:38px;height:38px;display:flex;align-items:center;justify-content:center;">
              <div style="position:absolute;inset:0;border-radius:9999px;background:rgba(16,185,129,0.28);"></div>
              <div style="position:relative;width:24px;height:24px;border-radius:9999px;background:#10B981;border:2.5px solid #ffffff;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(16,185,129,0.36);">
                <div style="width:9px;height:9px;border-radius:9999px;background:#ECFDF5;"></div>
              </div>
            </div>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      }),
    [isDelivery]
  );

  // Destination Marker: Slate Flag Pin (rides) OR Sky Blue ring (deliveries)
  const destinationIcon = useMemo(
    () =>
      L.divIcon({
        className: '',
        html: isDelivery
          ? `<div style="position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center;">
              <div style="position:absolute;inset:0;border-radius:9999px;background:rgba(14,165,233,0.22);"></div>
              <div style="position:relative;width:22px;height:22px;border-radius:9999px;background:#ffffff;border:5px solid #0EA5E9;box-shadow:0 4px 12px rgba(14,165,233,0.28);"></div>
            </div>`
          : `<div style="position:relative;width:34px;height:34px;display:flex;align-items:center;justify-content:center;">
              <div style="width:30px;height:30px;border-radius:9999px;background:#0F172A;border:3px solid #ffffff;display:flex;align-items:center;justify-content:center;box-shadow:0 5px 14px rgba(15,23,42,0.36);">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#38BDF8" stroke="#38BDF8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                  <line x1="4" y1="22" x2="4" y2="15"/>
                </svg>
              </div>
            </div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      }),
    [isDelivery]
  );

  const makeChevronIcon = (angleDeg: number) =>
    L.divIcon({
      className: '',
      html: `<div style="width:16px;height:16px;display:flex;align-items:center;justify-content:center;transform:rotate(${angleDeg}deg);pointer-events:none;">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 1px 1px rgba(0,0,0,0.35));">
          <path d="M18 15l-6-6-6 6"/>
        </svg>
      </div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });

  // Top-down sleek Go Driver vehicle SVG icon
  const makeVehicleIcon = (
    vehicleType: 'car' | 'moto' | 'delivery' = 'car',
    heading = 0,
    active = true
  ) =>
    L.divIcon({
      className: 'velo-smooth-marker',
      html: `<div style="position:relative;transform:rotate(${heading}deg);width:46px;height:46px;display:flex;align-items:center;justify-content:center;">
        ${
          vehicleType === 'moto' || vehicleType === 'delivery'
            ? `<div style="width:36px;height:36px;border-radius:9999px;background:${
                active ? '#0F172A' : '#FFFFFF'
              };border:2.5px solid ${active ? '#38BDF8' : '#2563EB'};display:flex;align-items:center;justify-content:center;box-shadow:0 6px 16px rgba(37,99,235,0.28);">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${
                  active ? '#60A5FA' : '#0F172A'
                }" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="2" width="6" height="5" rx="2" fill="${active ? '#38BDF8' : '#2563EB'}"/>
                  <path d="M7 9h10"/>
                  <rect x="8" y="9" width="8" height="10" rx="3" fill="${active ? '#FFFFFF' : '#DBEAFE'}" stroke="${active ? '#38BDF8' : '#2563EB'}"/>
                  <rect x="10" y="19" width="4" height="3" rx="1" fill="${active ? '#38BDF8' : '#2563EB'}"/>
                </svg>
              </div>`
            : `<div style="position:relative;width:28px;height:44px;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 5px 8px rgba(15,23,42,0.32));">
                <svg width="26" height="42" viewBox="0 0 36 58" fill="none">
                  <rect x="4" y="4" width="28" height="50" rx="11" fill="${active ? '#FFFFFF' : '#F4F6F9'}" stroke="${active ? '#2563EB' : '#0F172A'}" stroke-width="2.2"/>
                  <path d="M8 15C8 11 11 9 18 9C25 9 28 11 28 15L26 23H10L8 15Z" fill="#0F172A"/>
                  <rect x="9" y="24" width="18" height="14" rx="4" fill="#DBEAFE"/>
                  <path d="M10 40H26L27 45C27 47 24 49 18 49C12 49 9 47 9 45L10 40Z" fill="#1E293B"/>
                  <rect x="7" y="5" width="6" height="2.5" rx="1.2" fill="#38BDF8"/>
                  <rect x="23" y="5" width="6" height="2.5" rx="1.2" fill="#38BDF8"/>
                  <rect x="2" y="17" width="3" height="6" rx="1.5" fill="#0F172A"/>
                  <rect x="31" y="17" width="3" height="6" rx="1.5" fill="#0F172A"/>
                </svg>
              </div>`
        }
      </div>`,
      iconSize: [46, 46],
      iconAnchor: [23, 23],
    });

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#F4F6F9]">
      {/* Rotatable / 3D-tilted inner map viewport for 1st-Person Driving HUD */}
      <div
        className={
          isHudRotating
            ? 'leaflet-hud-viewport absolute left-1/2 top-1/2 h-[175vmax] w-[175vmax]'
            : 'leaflet-hud-viewport h-full w-full'
        }
        style={
          isHudRotating
            ? {
                transform: enable3dHud
                  ? `translate(-50%, -44%) perspective(950px) rotateX(55deg) rotateZ(${hudRotationDeg}deg) scale(1.14)`
                  : `translate(-50%, -50%) rotate(${hudRotationDeg}deg)`,
              }
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
          <OfflineTileLayerController routeCoords={routeCoords} isOnline={isOnline} />

          <MapController
            center={center}
            routeCoords={routeCoords}
            driverPosition={driverPosition}
            followVehicle={followVehicle}
            enable3dHud={enable3dHud}
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

          {/* Traveled Route Portion (Gray) */}
          {traveledCoords.length >= 2 && (
            <Polyline
              positions={traveledCoords}
              pathOptions={{ color: '#9CA3AF', weight: 6.5, opacity: 0.85 }}
            />
          )}

          {/* Remaining Route Ahead (Electric Blue with Deep Blue Casing) */}
          {remainingCoords.length >= 2 && (
            <>
              <Polyline
                positions={remainingCoords}
                pathOptions={{ color: '#1D4ED8', weight: 8.5, opacity: 0.95 }}
              />
              <Polyline
                positions={remainingCoords}
                pathOptions={{ color: '#38BDF8', weight: 4.5, opacity: 1 }}
              />
            </>
          )}

          {/* White Directional Chevrons along the blue path */}
          {routeChevrons.map((ch, idx) => (
            <Marker
              key={`chev-${idx}`}
              position={ch.pos}
              icon={makeChevronIcon(ch.angle)}
              interactive={false}
            />
          ))}

          {/* Passenger Live GPS Location Badge ("Eu") */}
          {userLocation && (
            <Marker
              position={[userLocation.lat, userLocation.lng]}
              icon={userLocationIcon}
              zIndexOffset={300}
            />
          )}

          {origin && (
            <Marker position={[origin.lat, origin.lng]} icon={originIcon} zIndexOffset={450}>
              <Popup>
                <div className="text-xs font-semibold text-neutral-900">
                  {origin.address}
                </div>
              </Popup>
            </Marker>
          )}

          {destination && (
            <Marker position={[destination.lat, destination.lng]} icon={destinationIcon} zIndexOffset={450}>
              <Popup>
                <div className="text-xs font-semibold text-neutral-900">
                  {destination.address}
                </div>
              </Popup>
            </Marker>
          )}

          {driverPosition && (
            <Marker
              position={[driverPosition.lat, driverPosition.lng]}
              icon={makeVehicleIcon(driverPosition.vehicleType || 'car', driverPosition.heading || 0, true)}
              zIndexOffset={600}
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
                ? t.deliverer_role_badge
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
        {/* 1st-Person Compass HUD Toggle */}
        {followVehicle && (
          <button
            type="button"
            onClick={handleToggleHudCompass}
            className={`flex h-11 px-3 items-center justify-center gap-1.5 rounded-2xl shadow-lg border text-[11px] font-extrabold active:scale-95 transition ${
              hudCompassEnabled
                ? 'bg-[#2563EB] text-white border-[#60A5FA]'
                : 'bg-white text-[#0F172A] border-[#E2E8F0]'
            }`}
            aria-label="Alternar bússola HUD 1ª pessoa"
            title="Rotação automática por bússola GPS"
          >
            <Compass
              className="h-4 w-4 transition-transform"
              style={{ transform: `rotate(${activeHeading}deg)` }}
            />
            <span>{enable3dHud ? '3D HUD' : 'HUD'}</span>
          </button>
        )}

        <div className="flex flex-col gap-1.5 items-end">
          <button
            type="button"
            onClick={() => zoomApiRef.current.zoomIn()}
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-[#0F172A] shadow-lg border border-[#E2E8F0] hover:bg-[#F4F6F9] active:scale-95 transition"
            aria-label="Aproximar mapa"
          >
            <Plus className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => zoomApiRef.current.zoomOut()}
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-[#0F172A] shadow-lg border border-[#E2E8F0] hover:bg-[#F4F6F9] active:scale-95 transition"
            aria-label="Afastar mapa"
          >
            <Minus className="h-5 w-5" />
          </button>
          {onRecenter && (
            <button
              type="button"
              onClick={handleRecenterClick}
              className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#2563EB] text-white shadow-lg border border-[#60A5FA]/50 hover:bg-[#1D4ED8] active:scale-95 transition"
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
          className="pointer-events-none absolute left-3 top-28 z-[500] flex h-[68px] w-[68px] flex-col items-center justify-center rounded-2xl bg-white text-[#0F172A] shadow-xl border-2 border-[#2563EB]"
          aria-label={`Velocidade atual ${Math.max(0, Math.round(speedKmh))} quilômetros por hora`}
        >
          <span className="font-mono-num text-2xl font-extrabold leading-none text-[#2563EB]">
            {Math.max(0, Math.round(speedKmh))}
          </span>
          <span className="mt-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[#475569]">
            km/h
          </span>
        </div>
      )}

      {/* Subtle Urban / Offline Mode Badge Top Left */}
      {!isOnline ? (
        <div className="pointer-events-none absolute left-3 top-20 z-[450] flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[10px] font-extrabold text-[#0F172A] shadow-lg border border-[#E2E8F0]">
          <WifiOff className="h-3 w-3 shrink-0 text-[#2563EB]" />
          <span>Navegação Offline · Mapa em Cache</span>
        </div>
      ) : (
        !showSpeedometer && (
          <div className="pointer-events-none hidden sm:flex absolute left-3 top-20 z-[450] items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold text-[#0F172A] shadow border border-[#E2E8F0]">
            <MapIcon className="h-3 w-3 text-[#2563EB]" />
            <span>{t.urban_mode}</span>
          </div>
        )
      )}
    </div>
  );
};
