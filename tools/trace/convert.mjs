// Converts hand-traced pixel shapes into DemoFeature JSON with closed, clockwise WGS84 rings.
// Usage: node convert.mjs <traced.json> <out.json>
// Each revision has `view` (a capture's -view.json, relative to traced.json) and one shape:
//   px: [[x, y], ...]                          polygon corners
//   rect: [cx, cy, length, width, angleDeg]    rotated rectangle, angle measured clockwise from +x on screen
//   line: [[x, y], ...], width                 corridor of that width around a centre line (roads)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const input = process.argv[2];
const traced = JSON.parse(readFileSync(input, 'utf8'));
const views = new Map();
const viewOf = (name) => {
  if (!views.has(name)) views.set(name, JSON.parse(readFileSync(resolve(dirname(input), name), 'utf8')));
  return views.get(name);
};
const R = 6378137;
const toLonLat = (view, [px, py]) => {
  const x = view.xmin + px * (view.xmax - view.xmin) / view.width;
  const y = view.ymax - py * (view.ymax - view.ymin) / view.height;
  return [Number((x / R * 180 / Math.PI).toFixed(7)), Number(((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI).toFixed(7))];
};
const signedArea = (ring) => ring.slice(1).reduce((sum, b, i) => sum + ring[i][0] * b[1] - b[0] * ring[i][1], 0) / 2;

function rectCorners([cx, cy, length, width, angle]) {
  const a = angle * Math.PI / 180;
  const u = [Math.cos(a) * length / 2, Math.sin(a) * length / 2];
  const v = [-Math.sin(a) * width / 2, Math.cos(a) * width / 2];
  return [[cx - u[0] - v[0], cy - u[1] - v[1]], [cx + u[0] - v[0], cy + u[1] - v[1]], [cx + u[0] + v[0], cy + u[1] + v[1]], [cx - u[0] + v[0], cy - u[1] + v[1]]];
}

// Offsets each vertex by half the width along the averaged normal of its segments.
function corridor(points, width) {
  const normals = points.slice(1).map((b, i) => {
    const a = points[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
  });
  const left = [], right = [];
  points.forEach((p, i) => {
    const n1 = normals[Math.max(0, i - 1)], n2 = normals[Math.min(normals.length - 1, i)];
    const n = [(n1[0] + n2[0]) / 2, (n1[1] + n2[1]) / 2];
    const len = Math.hypot(n[0], n[1]);
    left.push([p[0] + n[0] / len * width / 2, p[1] + n[1] / len * width / 2]);
    right.push([p[0] - n[0] / len * width / 2, p[1] - n[1] / len * width / 2]);
  });
  return [...left, ...right.reverse()];
}

const features = traced.features.map((f) => ({
  id: f.id, name: f.name, category: f.category, created: f.created, retired: f.retired ?? null,
  revisions: f.revisions.map((r) => {
    const view = viewOf(r.view ?? f.view);
    const shape = r.px ?? (r.rect ? rectCorners(r.rect) : corridor(r.line, r.width));
    let ring = shape.map((p) => toLonLat(view, p));
    if (signedArea([...ring, ring[0]]) > 0) ring.reverse();
    ring.push([...ring[0]]);
    return { epoch: r.epoch, ring, height: r.height };
  })
}));
writeFileSync(process.argv[3], JSON.stringify(features));
console.log(`converted ${features.length} features, ${features.reduce((n, f) => n + f.revisions.length, 0)} revisions`);
