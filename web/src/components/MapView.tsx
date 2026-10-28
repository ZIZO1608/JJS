import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { LatLng } from "@shared/maps";
import { useI18n } from "../lib/i18n";

export interface MapPoint extends LatLng {
  id: string;
  /** Shown inside the pin (the stop number). */
  label: string;
  title: string;
  done?: boolean;
}

/** Damascus — where the map opens when there is nothing to show yet. */
const HOME: LatLng = { lat: 33.5138, lng: 36.2765 };

const pinIcon = (label: string, cls: string) => L.divIcon({ className: "", html: `<div class="map-pin ${cls}"><span>${label}</span></div>`, iconSize: [34, 42], iconAnchor: [17, 40], popupAnchor: [0, -36] });

/**
 * OpenStreetMap with numbered pins, an optional route line between them in order, and an optional tap-to-pick spot.
 * Needs internet for the map tiles; says so instead of showing a grey box.
 */
export default function MapView({
  points = [],
  route = false,
  picked,
  onPick,
  className = "h-80",
}: {
  points?: MapPoint[];
  route?: boolean;
  picked?: LatLng | null;
  onPick?: (p: LatLng) => void;
  className?: string;
}) {
  const { tr } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: true, attributionControl: true }).setView([HOME.lat, HOME.lng], 12);
    const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(m);
    let loaded = false;
    tiles.on("tileload", () => ((loaded = true), setOffline(false)));
    tiles.on("tileerror", () => !loaded && setOffline(true));
    m.on("click", (e: L.LeafletMouseEvent) => pickRef.current?.({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) }));
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    // the map is often mounted inside a dialog that is still animating its size
    const t = setTimeout(() => m.invalidateSize(), 250);
    return () => {
      clearTimeout(t);
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const ll = points.map((p) => L.latLng(p.lat, p.lng));
    if (route && ll.length > 1) {
      L.polyline(ll, { color: "rgb(210 86 26)", weight: 9, opacity: 0.18 }).addTo(g);
      L.polyline(ll, { color: "rgb(210 86 26)", weight: 4, dashArray: "10 12", className: "route-ants" }).addTo(g);
    }
    points.forEach((p, i) => L.marker(ll[i]!, { icon: pinIcon(p.label, p.done ? "map-pin-done" : "") }).bindTooltip(p.title, { direction: "top", offset: [0, -34] }).addTo(g));
    if (picked) L.marker([picked.lat, picked.lng], { icon: pinIcon("★", "map-pin-pick") }).addTo(g);
    const all = picked ? [...ll, L.latLng(picked.lat, picked.lng)] : ll;
    if (all.length === 1) m.setView(all[0]!, Math.max(m.getZoom(), 15));
    else if (all.length > 1) m.fitBounds(L.latLngBounds(all), { padding: [40, 40], maxZoom: 16 });
  }, [points, route, picked]);

  return (
    <div className={`relative overflow-hidden rounded-xl border border-line ${className}`}>
      <div ref={box} className="h-full w-full" />
      {offline && (
        <div className="absolute inset-0 z-[500] grid place-items-center bg-sunken/90 p-4 text-center text-sm text-muted">
          {tr("الخريطة بدها إنترنت. باقي البرنامج شغّال عادي.", "The map needs internet. The rest of the app works as usual.")}
        </div>
      )}
    </div>
  );
}
