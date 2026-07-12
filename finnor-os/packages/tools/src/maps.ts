// Maps without a paid key: OpenStreetMap Nominatim geocoding (free, rate-limited —
// fine at dealer scale) + pure haversine distance for service-radius checks.

import { IntegrationError } from "./errors";

export interface GeoPoint {
  lat: number;
  lon: number;
  displayName: string;
}

export async function geocodeAddress(address: string): Promise<GeoPoint> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, {
    headers: { "user-agent": "finnor-os/0.1 (water treatment dealer platform)" },
  });
  if (!res.ok) throw new IntegrationError("maps", `geocode failed (${res.status})`, res.status >= 500);
  const rows = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  if (rows.length === 0) throw new IntegrationError("maps", `address not found: ${address}`, false);
  return { lat: Number(rows[0]!.lat), lon: Number(rows[0]!.lon), displayName: rows[0]!.display_name };
}

/** Great-circle distance in miles — pure, unit-testable. */
export function distanceMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}
