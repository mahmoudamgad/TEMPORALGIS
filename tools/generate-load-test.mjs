// Generates public/data/load-test.json: deterministic synthetic buildings for performance testing only.
// Usage: node tools/generate-load-test.mjs [count]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// YYYYMM months. Keep in sync with LOAD_TEST_EPOCHS in src/app/app.component.ts.
const EPOCHS = [201801, 202003, 202206, 202409, 202607];
const CENTER = [31.679, 29.9805];
const SPAN = 0.06;
const COUNT = Number(process.argv[2] ?? 20000);
const MIN_VERTICES = 30;
const MAX_VERTICES = 100;
const CATEGORIES = ['Residential', 'Commercial', 'Industrial'];

// mulberry32, so every run produces an identical file.
let seed = 20261101;
function random() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min, max) => min + random() * (max - min);
const pick = (items) => items[Math.floor(random() * items.length)];
const coord = (value) => Number(value.toFixed(6));

// A star-shaped outline walked clockwise, which is what ArcGIS expects for an outer ring.
function makeRing(lon, lat, radiusMeters, vertices, scale) {
  const metersPerLat = 110950;
  const metersPerLon = 111320 * Math.cos(lat * Math.PI / 180);
  const phaseA = between(0, Math.PI * 2);
  const phaseB = between(0, Math.PI * 2);
  const ring = [];
  for (let i = 0; i < vertices; i++) {
    const angle = -2 * Math.PI * i / vertices;
    const wobble = 1 + 0.18 * Math.sin(3 * angle + phaseA) + 0.09 * Math.sin(7 * angle + phaseB) + between(-0.03, 0.03);
    const radius = radiusMeters * wobble * scale;
    ring.push([coord(lon + radius * Math.cos(angle) / metersPerLon), coord(lat + radius * Math.sin(angle) / metersPerLat)]);
  }
  ring.push([...ring[0]]);
  return ring;
}

const columns = Math.ceil(Math.sqrt(COUNT));
const cell = SPAN / columns;
const features = [];
for (let index = 0; index < COUNT; index++) {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const lon = CENTER[0] - SPAN / 2 + (column + 0.5) * cell + between(-0.1, 0.1) * cell;
  const lat = CENTER[1] - SPAN / 2 + (row + 0.5) * cell + between(-0.1, 0.1) * cell;
  const vertices = Math.floor(between(MIN_VERTICES, MAX_VERTICES + 1));
  const radius = between(7, 13);
  const height = Math.round(between(6, 60));

  const created = random() < 0.88 ? EPOCHS[0] : pick(EPOCHS.slice(1));
  const later = EPOCHS.filter((epoch) => epoch > created);
  const retired = later.length && random() < 0.02 ? pick(later) : null;
  const revisions = [{ epoch: created, ring: makeRing(lon, lat, radius, vertices, 1), height }];
  const editable = later.filter((epoch) => retired === null || epoch < retired);
  if (editable.length && random() < 0.06) {
    revisions.push({ epoch: pick(editable), ring: makeRing(lon, lat, radius, vertices, 1.2), height: height + Math.round(between(3, 15)) });
  }

  features.push({
    id: `LT-${String(index).padStart(5, '0')}`,
    name: `Load test ${index}`,
    category: pick(CATEGORIES),
    created,
    retired,
    revisions
  });
}

const output = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/load-test.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(features));
console.log(`Wrote ${features.length} features to ${output}`);
