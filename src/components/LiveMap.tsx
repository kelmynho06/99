import React, { useEffect, useMemo } from 'react';
import L from 'leaflet';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { Crosshair, Minus, Plus } from 'lucide-react';
import type { GeoPoint, UserProfile } from '../types/mobility';

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

function ZoomControls({ onRecenter }: { onRecenter?: () => void }) {
  const map = useMap();

  return (
    <div className="pointer-events-auto absolute right-3 top-24 z-[500] flex flex-col gap-2">
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
}) => {
  const originIcon = useMemo(
    () =>
      L.divIcon({
        className: '',
        html: `<div style="width:24px;height:24px;border-radius:9999px;background:#FFCC00;border:4px solid #111827;box-shadow:0 4px 12px rgba(0,0,0,0.35);"></div>`,
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
      };border:3px solid ${active ? '#FFCC00' : '#111827'};display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(0,0,0,0.35);">
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
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapController
          center={center}
          routeCoords={routeCoords}
          pickOnMapMode={pickOnMapMode}
          onMapPick={onMapPick}
        />
        <ZoomControls onRecenter={onRecenter} />

        {origin && (
          <Marker position={[origin.lat, origin.lng]} icon={originIcon}>
            <Popup>
              <div className="text-xs font-semibold text-neutral-900">
                Embarque: {origin.address}
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

        {routeCoords && routeCoords.length >= 2 && (
          <>
            <Polyline
              positions={routeCoords}
              pathOptions={{ color: '#111827', weight: 7, opacity: 0.9 }}
            />
            <Polyline
              positions={routeCoords}
              pathOptions={{ color: '#FFCC00', weight: 3.5, opacity: 1 }}
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
          return (
            <Marker
              key={drv.id}
              position={[drv.driver.current_lat, drv.driver.current_lng]}
              icon={makeVehicleIcon(drv.driver.vehicle_type, drv.driver.heading, false)}
            >
              <Popup>
                <div className="text-xs font-semibold text-neutral-900">
                  {drv.full_name} · {drv.driver.vehicle_model}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
};
