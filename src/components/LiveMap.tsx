import React, { useEffect, useMemo, useState } from 'react';
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
import { Crosshair, Layers, Minus, Plus, Satellite, Map as MapIcon } from 'lucide-react';
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
}

function MapController({
  center,
  routeCoords,
  pickOnMapMode,
  onMapPick,
}: {
  center: [number, number];
  routeCoords?: [number, number][];
  pickOnMapMode?: 'origin' | 'destination' | null;
  onMapPick?: (lat: number, lng: number) => void;
}) {
  const map = useMap();

  useMapEvents({
    click(e) {
      if (pickOnMapMode && onMapPick) {
        onMapPick(e.latlng.lat, e.latlng.lng);
      }
    },
  });

  useEffect(() => {
    if (routeCoords && routeCoords.length >= 2) {
      const bounds = L.latLngBounds(routeCoords.map(([lat, lng]) => L.latLng(lat, lng)));
      map.fitBounds(bounds, { padding: [70, 70], maxZoom: 16 });
    }
  }, [map, routeCoords]);

  useEffect(() => {
    if (!routeCoords || routeCoords.length < 2) {
      map.setView(center, map.getZoom(), { animate: true });
    }
  }, [map, center, routeCoords]);

  return null;
}

function ZoomControls({
  onRecenter,
  layerMode,
  onToggleLayer,
  topClassName = 'top-24',
}: {
  onRecenter?: () => void;
  layerMode: MapLayerMode;
  onToggleLayer: () => void;
  topClassName?: string;
}) {
  const map = useMap();

  return (
    <div className={`pointer-events-auto absolute right-3 ${topClassName} z-[500] flex flex-col gap-2`}>
      <button
        type="button"
        onClick={onToggleLayer}
        className={`flex h-11 px-3 items-center justify-center gap-1.5 rounded-2xl shadow-lg border text-[11px] font-extrabold active:scale-95 transition ${
          layerMode === 'satellite'
            ? 'bg-neutral-950 text-[#FFD100] border-neutral-800'
            : 'bg-white text-neutral-900 border-neutral-200/80'
        }`}
        aria-label="Alternar entre mapa urbano e satélite rural"
        title="Alternar Urbano / Satélite Rural"
      >
        {layerMode === 'satellite' ? (
          <>
            <Satellite className="h-4 w-4 text-[#FFD100]" />
            <span>Satélite</span>
          </>
        ) : (
          <>
            <Layers className="h-4 w-4 text-blue-600" />
            <span>Urbano</span>
          </>
        )}
      </button>

      <div className="flex flex-col gap-1.5 items-end">
        <button
          type="button"
          onClick={() => map.zoomIn()}
          className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-neutral-900 shadow-lg border border-neutral-200/80 active:scale-95 transition"
          aria-label="Aproximar mapa"
        >
          <Plus className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => map.zoomOut()}
          className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-neutral-900 shadow-lg border border-neutral-200/80 active:scale-95 transition"
          aria-label="Afastar mapa"
        >
          <Minus className="h-5 w-5" />
        </button>
        {onRecenter && (
          <button
            type="button"
            onClick={onRecenter}
            className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#FFCC00] text-neutral-950 shadow-lg active:scale-95 transition"
            aria-label="Centralizar GPS"
            title="Minha localização"
          >
            <Crosshair className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
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
  controlsTopClassName,
}) => {
  const [internalLayerMode, setInternalLayerMode] = useState<MapLayerMode>('urban');
  const layerMode = controlledLayerMode ?? internalLayerMode;

  const toggleLayerMode = () => {
    const next: MapLayerMode = layerMode === 'urban' ? 'satellite' : 'urban';
    setInternalLayerMode(next);
    onLayerModeChange?.(next);
  };

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
      html: `<div style="transform:rotate(${heading}deg);width:40px;height:40px;border-radius:9999px;background:${
        active ? '#111827' : '#ffffff'
      };border:3px solid ${active ? '#FFCC00' : '#2563EB'};display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(0,0,0,0.35);">
        ${
          vehicleType === 'moto' || vehicleType === 'delivery'
            ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${
                active ? '#FFCC00' : '#111827'
              }" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-3 11.5V14l-3-3 4-3 2 3h3"/></svg>`
            : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${
                active ? '#FFCC00' : '#111827'
              }" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/></svg>`
        }
      </div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={center}
        zoom={15}
        dragging={true}
        touchZoom={true}
        scrollWheelZoom={true}
        doubleClickZoom={true}
        zoomControl={false}
        className="h-full w-full"
      >
        {layerMode === 'urban' ? (
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        ) : (
          <>
            <TileLayer
              attribution="Tiles &copy; Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />
            <TileLayer
              attribution="&copy; CARTO"
              url="https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png"
              maxZoom={19}
            />
          </>
        )}

        <MapController
          center={center}
          routeCoords={routeCoords}
          pickOnMapMode={pickOnMapMode}
          onMapPick={onMapPick}
        />
        <ZoomControls
          onRecenter={onRecenter}
          layerMode={layerMode}
          onToggleLayer={toggleLayerMode}
          topClassName={controlsTopClassName}
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

        {/* OSRM Blue Route Polyline */}
        {routeCoords && routeCoords.length >= 2 && (
          <>
            <Polyline
              positions={routeCoords}
              pathOptions={{ color: '#1E3A8A', weight: 8, opacity: 0.85 }}
            />
            <Polyline
              positions={routeCoords}
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

      {/* Subtle Map Mode Badge Bottom Left (hidden on small screens when covered, useful on Admin/desktop) */}
      <div className="pointer-events-none hidden sm:flex absolute left-3 top-20 z-[450] items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold text-neutral-700 shadow border border-neutral-200">
        {layerMode === 'satellite' ? (
          <>
            <Satellite className="h-3 w-3 text-amber-600" />
            <span>Satélite Rural</span>
          </>
        ) : (
          <>
            <MapIcon className="h-3 w-3 text-blue-600" />
            <span>Modo Urbano</span>
          </>
        )}
      </div>
    </div>
  );
};
