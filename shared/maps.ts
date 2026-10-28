// Reading a shop's position from a Google Maps link, and building a directions link for a route.

export type LatLng = { lat: number; lng: number };

const valid = (lat: number, lng: number): LatLng | null => (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat !== 0 || lng !== 0) ? { lat, lng } : null);

/**
 * Coordinates from a long Google Maps link (or plain "33.51, 36.27").
 * The pin (!3d…!4d…) wins over the camera (@lat,lng) because the camera is only where the map was looking.
 * Short links (maps.app.goo.gl) carry no coordinates: the server follows them first.
 */
export function parseLatLng(text: string): LatLng | null {
  const s = decodeURIComponent(text.trim());
  const patterns = [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, /[?&](?:q|query|ll|destination|center)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, /@(-?\d+\.\d+),(-?\d+\.\d+)/, /^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const p = valid(Number(m[1]), Number(m[2]));
      if (p) return p;
    }
  }
  return null;
}

/** Hosts we are willing to follow a short link to (nothing else is ever fetched). */
export const MAP_HOSTS = ["maps.app.goo.gl", "goo.gl", "maps.google.com", "www.google.com", "google.com"];

/** Turn-by-turn directions through every stop, in order, in Google Maps. */
export function directionsUrl(stops: LatLng[]) {
  if (!stops.length) return null;
  const f = (p: LatLng) => `${p.lat},${p.lng}`;
  const dest = stops[stops.length - 1]!;
  const mid = stops.slice(0, -1).map(f).join("|");
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${f(dest)}${mid ? `&waypoints=${encodeURIComponent(mid)}` : ""}`;
}

const km = (a: LatLng, b: LatLng) => {
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.hypot(x, y) * 6371;
};

/**
 * A short driving order: start at the first pinned stop, always go to the nearest one not visited yet,
 * then untangle crossing legs (2-opt). Stops without a pin keep their order at the end.
 */
export function shortRoute<T extends { lat: number | null; lng: number | null }>(stops: T[]): { ordered: T[]; km: number } {
  const pinned = stops.filter((s): s is T & LatLng => s.lat != null && s.lng != null);
  const rest = stops.filter((s) => s.lat == null || s.lng == null);
  if (pinned.length < 3) return { ordered: [...pinned, ...rest], km: pinned.length === 2 ? km(pinned[0]!, pinned[1]!) : 0 };
  const left = pinned.slice(1);
  const path = [pinned[0]!];
  while (left.length) {
    const here = path[path.length - 1]!;
    let best = 0;
    for (let i = 1; i < left.length; i++) if (km(here, left[i]!) < km(here, left[best]!)) best = i;
    path.push(left.splice(best, 1)[0]!);
  }
  for (let improved = true, n = 0; improved && n < 50; n++) {
    improved = false;
    for (let i = 0; i < path.length - 2; i++)
      for (let j = i + 2; j < path.length - 1; j++)
        if (km(path[i]!, path[j]!) + km(path[i + 1]!, path[j + 1]!) < km(path[i]!, path[i + 1]!) + km(path[j]!, path[j + 1]!) - 1e-9) {
          path.splice(i + 1, j - i, ...path.slice(i + 1, j + 1).reverse());
          improved = true;
        }
  }
  return { ordered: [...path, ...rest], km: path.slice(1).reduce((s, p, i) => s + km(path[i]!, p), 0) };
}
