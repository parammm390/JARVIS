// Deterministic synthetic-data generation shared by scripts/seed-dealer-zero.ts and
// apps/worker/src/simulator/plan.ts. Lives in @finnor/shared-types (not scripts/, which
// isn't a workspace package and isn't safe to import from a deployed app) so both a
// one-off seed script and the continuously-running worker can generate the identical
// "Finnor Water Co." synthetic universe without duplicating the generator.
//
// Every random value comes from a PURE hash of (seed, entity kind, index, slot) via
// rngFor() — never a single shared, sequentially-mutating generator. That distinction
// matters for idempotency: a shared mutating sequence desyncs the moment any draw is
// conditioned on state that differs between runs (e.g. "does this row already exist");
// a hash-derived generator for entity i depends only on i, so it can't drift.

export function mulberry32(seed: number) {
  let s = seed;
  return function next(): number {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashSeed(...parts: Array<string | number>): number {
  const s = parts.join("|");
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export const DEALER_ZERO_SEED = 953187; // fixed — changing this reseeds a different (still deterministic) universe.
export const DEALER_ZERO_TENANT_ID = "00000000-0000-4000-8000-0000000000d0";
export const DEALER_ZERO_TENANT_NAME = "Finnor Water Co. (Dealer Zero)";
export const DEALER_ZERO_AREA_CODE = "319"; // Cedar Falls / Waterloo, IA — same real metro this codebase's other synthetic fixtures already use.

export function rngFor(...parts: Array<string | number>): () => number {
  return mulberry32(hashSeed(DEALER_ZERO_SEED, ...parts));
}
export function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}
export function intBetween(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

// Real Cedar Falls / Waterloo, IA street names.
export const DEALER_ZERO_STREETS = [
  "University Ave", "College St", "Ansborough Ave", "Kimball Ave", "Broadway St",
  "Mullan Ave", "Rownd St", "Hudson Rd", "Greenhill Rd", "Franklin St",
  "West 1st St", "Ridgeway Ave", "San Marnan Dr", "Cedar Heights Dr", "Prairie Pkwy",
  "Main St", "Union Rd", "Viking Rd", "Dry Run Rd", "Shaulis Rd",
];
export const DEALER_ZERO_FIRST_NAMES = [
  "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda",
  "David", "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
  "Thomas", "Sarah", "Charles", "Karen", "Daniel", "Nancy", "Matthew", "Lisa",
  "Anthony", "Betty", "Mark", "Margaret", "Donald", "Sandra", "Steven", "Ashley",
  "Kevin", "Dorothy", "Brian", "Kimberly", "George", "Emily", "Edward", "Donna",
];
export const DEALER_ZERO_LAST_NAMES = [
  "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez",
  "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor",
  "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White", "Harris",
  "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen",
  "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green",
];
export const DEALER_ZERO_EQUIPMENT_TYPES = [
  { type: "water_softener", model: "Standard Softener 32k" },
  { type: "water_softener", model: "HE Softener 45k" },
  { type: "reverse_osmosis", model: "Standard 4-Stage RO" },
  { type: "whole_house_filter", model: "Whole-House Carbon Filtration" },
  { type: "iron_filter", model: "Iron & Sulfur Removal System" },
];

export interface SyntheticHousehold {
  key: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  hardnessGpg: number;
  ironPpm: number;
  source: "well" | "municipal";
  marketingConsent: boolean;
}

export function generateHousehold(keyPrefix: string, i: number): SyntheticHousehold {
  const rng = rngFor("household", keyPrefix, i);
  const first = pick(rng, DEALER_ZERO_FIRST_NAMES);
  const last = pick(rng, DEALER_ZERO_LAST_NAMES);
  const street = pick(rng, DEALER_ZERO_STREETS);
  const houseNum = intBetween(rng, 10, 9999);
  const city = rng() < 0.5 ? "Cedar Falls" : "Waterloo";
  const phoneSuffix = String(2000 + i).padStart(4, "0");
  return {
    key: `${keyPrefix}-${String(i + 1).padStart(3, "0")}`,
    name: `${first} ${last}`,
    address: `${houseNum} ${street}, ${city}, IA`,
    phone: `+1${DEALER_ZERO_AREA_CODE}555${phoneSuffix}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@dealerzero.finnorai.com`,
    hardnessGpg: Math.round((intBetween(rng, 30, 250) / 10) * 10) / 10, // 3.0-25.0 gpg
    ironPpm: Math.round(rng() * 20) / 10, // 0.0-2.0 ppm
    source: rng() < 0.6 ? "well" : "municipal",
    marketingConsent: rng() < 0.85, // ~85% consented at intake — realistic, not fabricated-uniform
  };
}
