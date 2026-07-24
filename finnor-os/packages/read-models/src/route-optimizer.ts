// B3.T1 — deliberately small, deterministic route ordering.  OSRM supplies real
// road distances; the optimizer never substitutes straight-line distance for a
// claimed driving-distance result.

export interface RoutePoint {
  id: string;
  label: string;
  lat: number;
  lon: number;
}

export interface OptimizedRoute {
  order: number[];
  naiveMeters: number;
  optimizedMeters: number;
  savedMeters: number;
}

export type DistanceMatrix = number[][];

export function routeDistance(order: number[], matrix: DistanceMatrix): number {
  return order.slice(1).reduce((total, point, index) => total + matrix[order[index]!]![point]!, 0);
}

/** Start from the first scheduled stop, then repeatedly take the nearest unvisited
 * stop.  That fixed start makes the comparison with the day's existing order fair. */
export function nearestNeighbor(matrix: DistanceMatrix): number[] {
  if (matrix.length === 0) return [];
  const order = [0];
  const remaining = new Set(matrix.map((_, index) => index).slice(1));
  while (remaining.size > 0) {
    const current = order[order.length - 1]!;
    const next = [...remaining].sort((a, b) => matrix[current]![a]! - matrix[current]![b]! || a - b)[0]!;
    order.push(next);
    remaining.delete(next);
  }
  return order;
}

/** Deterministic 2-opt improvement.  A route is open: it starts at the first
 * scheduled stop and does not invent an unrecorded technician depot or return leg. */
export function twoOpt(order: number[], matrix: DistanceMatrix): number[] {
  let best = [...order];
  let improved = true;
  while (improved) {
    improved = false;
    for (let start = 1; start < best.length - 1 && !improved; start += 1) {
      for (let end = start + 1; end < best.length; end += 1) {
        const candidate = [...best.slice(0, start), ...best.slice(start, end + 1).reverse(), ...best.slice(end + 1)];
        if (routeDistance(candidate, matrix) < routeDistance(best, matrix)) {
          best = candidate;
          improved = true;
          break;
        }
      }
    }
  }
  return best;
}

export function optimizeRoute(matrix: DistanceMatrix): OptimizedRoute {
  if (matrix.some((row) => row.length !== matrix.length)) throw new Error("Route matrix must be square");
  const naive = matrix.map((_, index) => index);
  const order = twoOpt(nearestNeighbor(matrix), matrix);
  const naiveMeters = routeDistance(naive, matrix);
  const optimizedMeters = routeDistance(order, matrix);
  return { order, naiveMeters, optimizedMeters, savedMeters: Math.max(0, naiveMeters - optimizedMeters) };
}

/** OSRM's public demo is intentionally used only for the internal-grade daily
 * suggestion.  A non-OK or incomplete matrix is a loud failure, never a made-up
 * driving result. */
export async function osrmMatrix(points: RoutePoint[], request: typeof fetch = fetch): Promise<DistanceMatrix> {
  if (points.length === 0) return [];
  const coordinates = points.map((point) => `${point.lon},${point.lat}`).join(";");
  const response = await request(`https://router.project-osrm.org/table/v1/driving/${coordinates}?annotations=distance`);
  if (!response.ok) throw new Error(`OSRM matrix failed (${response.status})`);
  const body = (await response.json()) as { code?: string; distances?: Array<Array<number | null>> };
  if (body.code !== "Ok" || !body.distances || body.distances.length !== points.length || body.distances.some((row) => row.length !== points.length || row.some((value) => typeof value !== "number"))) {
    throw new Error("OSRM matrix response was incomplete");
  }
  return body.distances as DistanceMatrix;
}

export async function osrmDurationMatrix(points: RoutePoint[], request: typeof fetch = fetch): Promise<DistanceMatrix> {
  if (points.length === 0) return [];
  const coordinates = points.map((point) => `${point.lon},${point.lat}`).join(";");
  const response = await request(`https://router.project-osrm.org/table/v1/driving/${coordinates}?annotations=duration`);
  if (!response.ok) throw new Error(`OSRM duration matrix failed (${response.status})`);
  const body = (await response.json()) as { code?: string; durations?: Array<Array<number | null>> };
  if (body.code !== "Ok" || !body.durations || body.durations.length !== points.length || body.durations.some((row) => row.length !== points.length || row.some((value) => typeof value !== "number"))) {
    throw new Error("OSRM duration matrix response was incomplete");
  }
  return body.durations as DistanceMatrix;
}
