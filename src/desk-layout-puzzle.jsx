import React, { useState, useRef, useMemo, useEffect } from "react";
import { Plus, Circle, Trash2, Users, MessageCircle, Move, Sparkles, Ruler, DoorOpen, RotateCcw, Minus, Eye } from "lucide-react";

/* ---------- geometry constants ---------- */
const H = Math.sqrt(3) / 2; // trapezoid height (short=1, long=2, legs=1)
const LOCAL_VERTS = [
  [-0.5, -H / 2], // A short-left
  [0.5, -H / 2], // B short-right
  [1, H / 2], // C long-right
  [-1, H / 2], // D long-left
];
const EDGE_DEFS = [
  { name: "short", a: 0, b: 1, len: 1 },
  { name: "rightLeg", a: 1, b: 2, len: 1 },
  { name: "long", a: 2, b: 3, len: 2 },
  { name: "leftLeg", a: 3, b: 0, len: 1 },
];
// 6 valid chair attachment points per desk
const ATTACH_POINTS = [
  { key: "short", parentEdge: "short", localMid: [0, -H / 2], outAngle: -90 },
  { key: "rightLeg", parentEdge: "rightLeg", localMid: [0.75, 0], outAngle: -30 },
  { key: "longL", parentEdge: "long", localMid: [-0.5, H / 2], outAngle: 90 },
  { key: "longC", parentEdge: "long", localMid: [0, H / 2], outAngle: 90 },
  { key: "longR", parentEdge: "long", localMid: [0.5, H / 2], outAngle: 90 },
  { key: "leftLeg", parentEdge: "leftLeg", localMid: [-0.75, 0], outAngle: 210 },
];

const SCALE = 52; // px per meter
const MARGIN = 34;
const CORNER_SNAP = 0.4; // 40cm default
const EDGE_SNAP = 0.4; // 40cm default
const CHAIR_SNAP = 0.2; // 20cm
const CHAIR_RADIUS = 0.32;
const TAP_MOVE_THRESHOLD = 6; // px
const ROTATE_STEP = 30; // degrees per tap
const OVERLAP_EPS = 0.01; // 1cm tolerance so flush/snapped pieces aren't flagged as overlapping
const DOOR_WIDTH = 1;
const MAX_DOORS = 4;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;

/* ---------- pure geometry helpers ---------- */
function rotatePoint([x, y], deg) {
  const r = (deg * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
}
function worldPoint(local, piece) {
  const [rx, ry] = rotatePoint(local, piece.rot);
  return [rx + piece.x, ry + piece.y];
}
function deskPolygon(piece) {
  return LOCAL_VERTS.map((v) => worldPoint(v, piece));
}
function edgeWorld(piece, edgeDef) {
  return [worldPoint(LOCAL_VERTS[edgeDef.a], piece), worldPoint(LOCAL_VERTS[edgeDef.b], piece)];
}
function dist(p, q) {
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}
function mid(p, q) {
  return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
}
function sub(p, q) {
  return [p[0] - q[0], p[1] - q[1]];
}
function norm(v) {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
}
function edgesCoincident(e1, e2, tol = 0.12) {
  const d1 = dist(e1[0], e2[0]) + dist(e1[1], e2[1]);
  const d2 = dist(e1[0], e2[1]) + dist(e1[1], e2[0]);
  return Math.min(d1, d2) < tol * 2;
}
function polygonArea(poly) {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}
function project(poly, axis) {
  let min = Infinity,
    max = -Infinity;
  for (const [x, y] of poly) {
    const p = x * axis[0] + y * axis[1];
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return [min, max];
}
function satOverlap(polyA, polyB, eps = OVERLAP_EPS) {
  for (const poly of [polyA, polyB]) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i],
        p2 = poly[(i + 1) % poly.length];
      const axis = [-(p2[1] - p1[1]), p2[0] - p1[0]];
      const [minA, maxA] = project(polyA, axis);
      const [minB, maxB] = project(polyB, axis);
      if (maxA <= minB + eps || maxB <= minA + eps) return false;
    }
  }
  return true;
}
function pointSegDist(pt, a, b) {
  const d = sub(b, a);
  const len2 = d[0] * d[0] + d[1] * d[1];
  if (len2 < 1e-9) return dist(pt, a);
  let t = ((pt[0] - a[0]) * d[0] + (pt[1] - a[1]) * d[1]) / len2;
  t = Math.max(0, Math.min(1, t));
  const proj = [a[0] + d[0] * t, a[1] + d[1] * t];
  return dist(pt, proj);
}
function polyPointMinDist(poly, pt) {
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = pointSegDist(pt, poly[i], poly[(i + 1) % poly.length]);
    if (d < min) min = d;
  }
  return min;
}
function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0],
      yi = poly[i][1],
      xj = poly[j][0],
      yj = poly[j][1];
    const intersect = yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
function circleOverlapsPoly(center, r, poly, eps = OVERLAP_EPS) {
  if (pointInPolygon(center, poly)) return true;
  return polyPointMinDist(poly, center) < r - eps;
}
function circleOverlapsCircle(c1, c2, r1, r2, eps = OVERLAP_EPS) {
  return dist(c1, c2) < r1 + r2 - eps;
}
function segDist(p1, p2, p3, p4) {
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const d1 = sub(p2, p1),
    d2 = sub(p4, p3),
    r = sub(p1, p3);
  const a = d1[0] * d1[0] + d1[1] * d1[1];
  const e = d2[0] * d2[0] + d2[1] * d2[1];
  const f = d2[0] * r[0] + d2[1] * r[1];
  let s, t;
  if (a <= 1e-9 && e <= 1e-9) {
    s = t = 0;
  } else if (a <= 1e-9) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1[0] * r[0] + d1[1] * r[1];
    if (e <= 1e-9) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1[0] * d2[0] + d1[1] * d2[1];
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  const cp1 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s];
  const cp2 = [p3[0] + d2[0] * t, p3[1] + d2[1] * t];
  return Math.hypot(cp1[0] - cp2[0], cp1[1] - cp2[1]);
}
function polyMinDist(polyA, polyB) {
  let min = Infinity;
  for (let i = 0; i < polyA.length; i++) {
    const a1 = polyA[i],
      a2 = polyA[(i + 1) % polyA.length];
    for (let j = 0; j < polyB.length; j++) {
      const d = segDist(a1, a2, polyB[j], polyB[(j + 1) % polyB.length]);
      if (d < min) min = d;
    }
  }
  return min;
}
function polySegMinDist(poly, p1, p2) {
  let min = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = segDist(poly[i], poly[(i + 1) % poly.length], p1, p2);
    if (d < min) min = d;
  }
  return min;
}
function angleDiff(a, b) {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

/* ---------- corridor (1m-wide path from each seat to an exit) ---------- */
const CORRIDOR_CELL = 0.25;
const CORRIDOR_CLEARANCE = 0.5; // half of the required 1m width (full-width threshold for the overlay)
function buildWallSegments(doors, roomW, roomH) {
  const segs = [];
  wallDefs(roomW, roomH).forEach((w) => {
    const dir = norm(sub(w.p2, w.p1));
    const gaps = doors
      .filter((d) => d.wall === w.key)
      .map((d) => {
        const off = Math.max(0, Math.min(d.offset, w.len - DOOR_WIDTH));
        return [off, off + DOOR_WIDTH];
      })
      .sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    gaps.forEach(([s, e]) => {
      if (s > cursor) segs.push({ p1: [w.p1[0] + dir[0] * cursor, w.p1[1] + dir[1] * cursor], p2: [w.p1[0] + dir[0] * s, w.p1[1] + dir[1] * s] });
      cursor = Math.max(cursor, e);
    });
    if (cursor < w.len) segs.push({ p1: [w.p1[0] + dir[0] * cursor, w.p1[1] + dir[1] * cursor], p2: w.p2 });
  });
  return segs;
}
// continuous clearance field: distance from each cell center to the nearest obstacle (desk or solid wall)
// a chair's physical footprint: 1x1m square flush against its desk edge, oriented along
// that edge's outward axis (independent of the chair's own visual facing/rotation)
function chairDeskAngleRad(chairX, chairY, desks) {
  const pts = attachPointsList(desks);
  if (pts.length === 0) return 0;
  let best = null,
    bestD = Infinity;
  pts.forEach((p) => {
    const d = dist(p.chairCenter, [chairX, chairY]);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  });
  return (best.frontAngleDeg * Math.PI) / 180;
}
function chairObstaclePolys(chairs, desks) {
  return chairs.map((c) => rectVerts(c.x, c.y, chairDeskAngleRad(c.x, c.y, desks), 1, 1));
}
function buildClearanceGrid(desks, doors, chairs, roomW, roomH) {
  const cell = CORRIDOR_CELL;
  const cols = Math.ceil(roomW / cell);
  const rows = Math.ceil(roomH / cell);
  const deskPolys = desks.map((d) => deskPolygon(d));
  const chairPolys = chairObstaclePolys(chairs, desks);
  const obstaclePolys = deskPolys.concat(chairPolys);
  const wallSegs = buildWallSegments(doors, roomW, roomH);
  const clearance = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) * cell;
      const cy = (r + 0.5) * cell;
      let d = Infinity;
      let inside = false;
      for (const poly of obstaclePolys) {
        if (pointInPolygon([cx, cy], poly)) {
          inside = true;
          break;
        }
        const pd = polyPointMinDist(poly, [cx, cy]);
        if (pd < d) d = pd;
      }
      if (inside) {
        d = 0;
      } else {
        for (const seg of wallSegs) {
          const wd = pointSegDist([cx, cy], seg.p1, seg.p2);
          if (wd < d) d = wd;
        }
      }
      clearance[r * cols + c] = d;
    }
  }
  return { cols, rows, cell, clearance };
}
function findExitSeeds(grid, doors, roomW, roomH) {
  const seeds = [];
  const { cols, rows, cell, clearance } = grid;
  doors.forEach((door) => {
    const g = doorGeom(door, roomW, roomH);
    const dir = norm(sub(g.p2, g.p1));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (clearance[idx] <= 0) continue;
        const cx = (c + 0.5) * cell;
        const cy = (r + 0.5) * cell;
        const rel = sub([cx, cy], g.p1);
        const proj = rel[0] * dir[0] + rel[1] * dir[1];
        if (proj < -0.1 || proj > DOOR_WIDTH + 0.1) continue;
        if (pointSegDist([cx, cy], g.p1, g.p2) < 0.6) seeds.push(idx);
      }
    }
  });
  return seeds;
}
// widest-path (maximin) Dijkstra: for every cell, find the path to an exit that maximizes
// the minimum clearance encountered along the way (the bottleneck of the best available route)
function maximinDijkstra(grid, seeds) {
  const { cols, rows, clearance, cell } = grid;
  const total = cols * rows;
  const best = new Float64Array(total).fill(-1);
  const bestDist = new Float64Array(total).fill(Infinity);
  const parent = new Int32Array(total).fill(-1);
  const heap = []; // entries: [bottleneck, dist, idx]
  const better = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] < b[1]); // higher bottleneck wins; tie -> shorter distance wins
  function push(v, d, i) {
    heap.push([v, d, i]);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (better(heap[c], heap[p])) {
        [heap[p], heap[c]] = [heap[c], heap[p]];
        c = p;
      } else break;
    }
  }
  function pop() {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let c = 0;
      while (true) {
        let l = 2 * c + 1,
          r = 2 * c + 2,
          m = c;
        if (l < heap.length && better(heap[l], heap[m])) m = l;
        if (r < heap.length && better(heap[r], heap[m])) m = r;
        if (m !== c) {
          [heap[c], heap[m]] = [heap[m], heap[c]];
          c = m;
        } else break;
      }
    }
    return top;
  }
  seeds.forEach((s) => {
    if (best[s] === -1) {
      best[s] = clearance[s];
      bestDist[s] = 0;
      parent[s] = -2;
      push(clearance[s], 0, s);
    }
  });
  while (heap.length > 0) {
    const [val, d, cur] = pop();
    if (val < best[cur] || (val === best[cur] && d > bestDist[cur])) continue;
    const r = Math.floor(cur / cols);
    const c = cur % cols;
    const DIAG = Math.SQRT2;
    const neighbors = [
      [r - 1, c, 1],
      [r + 1, c, 1],
      [r, c - 1, 1],
      [r, c + 1, 1],
      [r - 1, c - 1, DIAG],
      [r - 1, c + 1, DIAG],
      [r + 1, c - 1, DIAG],
      [r + 1, c + 1, DIAG],
    ];
    for (const [nr, nc, mult] of neighbors) {
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      const nidx = nr * cols + nc;
      if (clearance[nidx] <= 0) continue; // solid — never traversable, not just "0 width"
      const candidate = Math.min(val, clearance[nidx]);
      const candidateDist = d + cell * mult;
      const isBetter = candidate > best[nidx] || (candidate === best[nidx] && candidateDist < bestDist[nidx]);
      if (isBetter) {
        best[nidx] = candidate;
        bestDist[nidx] = candidateDist;
        parent[nidx] = cur;
        push(candidate, candidateDist, nidx);
      }
    }
  }
  return { best, bestDist, parent };
}
function cellIndexForPoint(pt, grid) {
  const c = Math.floor(pt[0] / grid.cell);
  const r = Math.floor(pt[1] / grid.cell);
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return -1;
  return r * grid.cols + c;
}
function tracePath(parent, startIdx) {
  const path = [];
  let cur = startIdx;
  let guard = 0;
  while (cur !== -2 && cur !== -1 && guard < 200000) {
    path.push(cur);
    cur = parent[cur];
    guard++;
  }
  return path;
}
// merge per-cell reachable-width levels into horizontal runs so the overlay can be drawn
// with a handful of rects per row instead of one per cell
function corridorOverlayRuns(grid, best) {
  const { cols, rows } = grid;
  const runs = [];
  for (let r = 0; r < rows; r++) {
    let runStart = -1;
    let runLevel = 0;
    for (let c = 0; c <= cols; c++) {
      const val = c < cols ? best[r * cols + c] : -Infinity;
      let level = 0;
      if (val >= CORRIDOR_CLEARANCE) level = 2;
      else if (val > 0) level = 1;
      if (level !== runLevel) {
        if (runLevel > 0 && runStart >= 0) runs.push({ row: r, colStart: runStart, colEnd: c - 1, level: runLevel });
        runStart = level > 0 ? c : -1;
        runLevel = level;
      }
    }
  }
  return runs;
}
// per-seat "narrowest point on the best route to an exit", capped at 1m (per the requested formula)
function pointClearance(pt, obstaclePolys, wallSegs) {
  let d = Infinity;
  for (const poly of obstaclePolys) {
    if (pointInPolygon(pt, poly)) return 0;
    const pd = polyPointMinDist(poly, pt);
    if (pd < d) d = pd;
  }
  for (const seg of wallSegs) {
    const wd = pointSegDist(pt, seg.p1, seg.p2);
    if (wd < d) d = wd;
  }
  return d;
}
function closestPointOnSeg(pt, a, b) {
  const d = sub(b, a);
  const len2 = d[0] * d[0] + d[1] * d[1];
  if (len2 < 1e-9) return a;
  let t = ((pt[0] - a[0]) * d[0] + (pt[1] - a[1]) * d[1]) / len2;
  t = Math.max(0, Math.min(1, t));
  return [a[0] + d[0] * t, a[1] + d[1] * t];
}
function nearestObstaclePoint(pt, obstaclePolys, wallSegs) {
  let bestDist = Infinity,
    bestPoint = null;
  for (const poly of obstaclePolys) {
    for (let i = 0; i < poly.length; i++) {
      const cp = closestPointOnSeg(pt, poly[i], poly[(i + 1) % poly.length]);
      const d = dist(pt, cp);
      if (d < bestDist) {
        bestDist = d;
        bestPoint = cp;
      }
    }
  }
  for (const seg of wallSegs) {
    const cp = closestPointOnSeg(pt, seg.p1, seg.p2);
    const d = dist(pt, cp);
    if (d < bestDist) {
      bestDist = d;
      bestPoint = cp;
    }
  }
  return bestPoint;
}
// the real passable width at a point: nearest obstacle on EACH side of the direction of travel,
// added together — not just the nearest obstacle on whichever side happens to be closest, doubled.
// (a point hugging one wall with wide open space on the other side is NOT actually a bottleneck;
// a point pinched between two things on opposite sides genuinely is)
function crossSectionWidth(pt, travelDir, obstaclePolys, wallSegs) {
  const perp = norm([-travelDir[1], travelDir[0]]);
  let leftDist = Infinity,
    rightDist = Infinity,
    leftPt = null,
    rightPt = null;
  function consider(cp) {
    const rel = sub(cp, pt);
    const side = rel[0] * perp[0] + rel[1] * perp[1];
    const d = dist(pt, cp);
    if (side >= 0) {
      if (d < leftDist) {
        leftDist = d;
        leftPt = cp;
      }
    } else {
      if (d < rightDist) {
        rightDist = d;
        rightPt = cp;
      }
    }
  }
  for (const poly of obstaclePolys) {
    for (let i = 0; i < poly.length; i++) consider(closestPointOnSeg(pt, poly[i], poly[(i + 1) % poly.length]));
  }
  for (const seg of wallSegs) consider(closestPointOnSeg(pt, seg.p1, seg.p2));
  const width = (leftDist === Infinity ? 0 : leftDist) + (rightDist === Infinity ? 0 : rightDist);
  return { width, leftPt, rightPt };
}
function bothSideBoundaries(pt, obstaclePolys, wallSegs) {
  const near1 = nearestObstaclePoint(pt, obstaclePolys, wallSegs);
  if (!near1) return { near1: null, near2: null };
  const dir1 = norm(sub(near1, pt));
  let bestDist2 = Infinity,
    near2 = null;
  function consider(cp) {
    const dir = norm(sub(cp, pt));
    const dot = dir[0] * dir1[0] + dir[1] * dir1[1];
    if (dot < 0.2) {
      const d = dist(pt, cp);
      if (d < bestDist2) {
        bestDist2 = d;
        near2 = cp;
      }
    }
  }
  for (const poly of obstaclePolys) {
    for (let i = 0; i < poly.length; i++) consider(closestPointOnSeg(pt, poly[i], poly[(i + 1) % poly.length]));
  }
  for (const seg of wallSegs) consider(closestPointOnSeg(pt, seg.p1, seg.p2));
  return { near1, near2 };
}
function resamplePolyline(points, step) {
  if (points.length < 2) return points.slice();
  const result = [points[0]];
  let accumulated = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segLen = dist(a, b);
    if (segLen < 1e-9) continue;
    const dir = [(b[0] - a[0]) / segLen, (b[1] - a[1]) / segLen];
    let remaining = segLen;
    let pos = a;
    let distToNext = step - accumulated;
    while (distToNext < remaining) {
      pos = [pos[0] + dir[0] * distToNext, pos[1] + dir[1] * distToNext];
      result.push(pos);
      remaining -= distToNext;
      distToNext = step;
      accumulated = 0;
    }
    accumulated += remaining;
  }
  result.push(points[points.length - 1]);
  return result;
}
function chaikinSmooth(points, weights, iterations) {
  let pts = points.slice();
  let w = weights.slice();
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) break;
    const newPts = [pts[0]];
    const newW = [w[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i],
        p1 = pts[i + 1];
      const w0 = w[i],
        w1 = w[i + 1];
      newPts.push([p0[0] * 0.75 + p1[0] * 0.25, p0[1] * 0.75 + p1[1] * 0.25], [p0[0] * 0.25 + p1[0] * 0.75, p0[1] * 0.25 + p1[1] * 0.75]);
      newW.push(w0 * 0.75 + w1 * 0.25, w0 * 0.25 + w1 * 0.75);
    }
    newPts.push(pts[pts.length - 1]);
    newW.push(w[w.length - 1]);
    pts = newPts;
    w = newW;
  }
  // keep the exact original endpoints (chair back / door opening)
  pts[0] = points[0];
  pts[pts.length - 1] = points[points.length - 1];
  w[0] = weights[0];
  w[w.length - 1] = weights[weights.length - 1];
  return { pts, w };
}
function computeCorridors(desks, doors, chairs, roomW, roomH, selectedChairId) {
  const deskPolys = desks.map((d) => deskPolygon(d));
  const wallSegs = buildWallSegments(doors, roomW, roomH);
  const chairPolys = chairObstaclePolys(chairs, desks); // index-aligned with `chairs`
  // one shared grid where every chair (including each chair's own square) is a real obstacle,
  // so no path can ever cut through a chair. This grid is only used to find the ROUTE
  // (which way to go); the actual width along that route is measured exactly, not grid-sampled.
  const grid = buildClearanceGrid(desks, doors, chairs, roomW, roomH);
  const seeds = findExitSeeds(grid, doors, roomW, roomH);
  const { best, bestDist, parent } = maximinDijkstra(grid, seeds);
  const doorGeoms = doors.map((d) => doorGeom(d, roomW, roomH));
  function evaluateFromStart(startPt, c, deskAngle, otherObstacles, isSelected) {
    const dirToStart = norm(sub(startPt, [c.x, c.y]));
    // step out a bit further than the exact edge for finding which grid cell to route from —
    // right at the boundary, grid-cell sampling can occasionally misclassify it as still inside
    // the chair's own footprint (which is excluded from routing since it's solid)
    const routingSeed = [startPt[0] + dirToStart[0] * grid.cell, startPt[1] + dirToStart[1] * grid.cell];
    const idx = cellIndexForPoint(routingSeed, grid);
    const cellPath = idx >= 0 ? tracePath(parent, idx) : [];
    const reachable = idx >= 0 && cellPath.length > 0;
    if (!reachable) return { reachable: false, width: 0 };

    const worldPts = [startPt, ...cellPath.map((pIdx) => {
      const r = Math.floor(pIdx / grid.cols);
      const cc = pIdx % grid.cols;
      return [(cc + 0.5) * grid.cell, (r + 0.5) * grid.cell];
    })];
    let doorPt = null;
    if (doorGeoms.length > 0) {
      const lastPt = worldPts[worldPts.length - 1];
      let nearestDoor = null,
        bestDoorDist = Infinity;
      doorGeoms.forEach((g) => {
        const cp = closestPointOnSeg(lastPt, g.p1, g.p2);
        const d = dist(lastPt, cp);
        if (d < bestDoorDist) {
          bestDoorDist = d;
          nearestDoor = g;
        }
      });
      if (nearestDoor) {
        doorPt = mid(nearestDoor.p1, nearestDoor.p2);
        worldPts.push(doorPt);
      }
    }
    // measure on the raw (unsmoothed) route — this is what the search actually verified was clear;
    // smoothing (for how the line looks) can cut slightly closer to a corner than the real route did
    const finePts = resamplePolyline(worldPts, 0.01);
    let minVal = Infinity,
      minIdx = -1,
      minLeft = null,
      minRight = null;
    finePts.forEach((pos, i) => {
      const prev = finePts[Math.max(0, i - 1)];
      const next = finePts[Math.min(finePts.length - 1, i + 1)];
      const travelDir = norm(sub(next, prev));
      const cs = crossSectionWidth(pos, travelDir, otherObstacles, wallSegs);
      if (cs.width < minVal) {
        minVal = cs.width;
        minIdx = i;
        minLeft = cs.leftPt;
        minRight = cs.rightPt;
      }
    });
    // guarantee: the exact start point and the exact door point are always checked directly,
    // no matter how the sampling in between behaves
    let forcedPoint = null;
    const startDir = norm(sub(worldPts[Math.min(1, worldPts.length - 1)], worldPts[0]));
    const startCS = crossSectionWidth(startPt, startDir, otherObstacles, wallSegs);
    if (startCS.width < minVal) {
      minVal = startCS.width;
      forcedPoint = startPt;
      minLeft = startCS.leftPt;
      minRight = startCS.rightPt;
    }
    if (doorPt) {
      const doorDir = norm(sub(doorPt, worldPts[Math.max(0, worldPts.length - 2)]));
      const doorCS = crossSectionWidth(doorPt, doorDir, otherObstacles, wallSegs);
      if (doorCS.width < minVal) {
        minVal = doorCS.width;
        forcedPoint = doorPt;
        minLeft = doorCS.leftPt;
        minRight = doorCS.rightPt;
      }
    }
    let width = minVal > 0 && minVal < Infinity ? minVal : 0;
    let bottleneckExact = null,
      arrowNear = null,
      arrowFar = null,
      path = [];
    if ((minIdx >= 0 || forcedPoint) && width > 0 && isSelected) {
      bottleneckExact = forcedPoint || finePts[minIdx];
      arrowNear = minLeft;
      arrowFar = minRight;
      if (Math.abs(width - 1.0) < 0.03) width = 1.0;
    }
    if (isSelected) {
      const dummyW = worldPts.map(() => 0);
      const smoothedRoute = worldPts.length >= 3 ? chaikinSmooth(worldPts, dummyW, 2).pts : worldPts;
      path = resamplePolyline(smoothedRoute, 0.05);
    }
    return { reachable: width > 0, width, bottleneckExact, arrowNear, arrowFar, path };
  }

  const results = chairs.map((c, ci) => {
    const isSelected = c.id === selectedChairId;
    const deskAngle = chairDeskAngleRad(c.x, c.y, desks); // inward (toward-desk) direction from attachPointsList
    const otherObstacles = deskPolys.concat(chairPolys.filter((_, j) => j !== ci));
    // getting up from a chair means sliding out to a side, not pushing straight back — the path
    // starts at the midpoint of a side edge and heads out perpendicular to it. Try both sides
    // and keep whichever gives the better route.
    const perpDir = [Math.sin(deskAngle), -Math.cos(deskAngle)];
    const leftStart = [c.x + perpDir[0] * 0.5, c.y + perpDir[1] * 0.5];
    const rightStart = [c.x - perpDir[0] * 0.5, c.y - perpDir[1] * 0.5];
    const leftResult = evaluateFromStart(leftStart, c, deskAngle, otherObstacles, isSelected);
    const rightResult = evaluateFromStart(rightStart, c, deskAngle, otherObstacles, isSelected);
    let best_ = leftResult;
    if (rightResult.reachable && (!leftResult.reachable || rightResult.width > leftResult.width)) best_ = rightResult;

    const cappedWidth = Math.min(best_.width || 0, 1);
    return { chairId: c.id, reachable: !!best_.reachable, width: best_.width || 0, cappedWidth, bottleneckExact: best_.bottleneckExact || null, arrowNear: best_.arrowNear || null, arrowFar: best_.arrowFar || null, path: best_.path || [] };
  });
  const avgMovability = results.length ? results.reduce((s, r) => s + r.cappedWidth, 0) / results.length : 0;
  return { results, avgMovability };
}


function roundedPolyPath(pts, r) {
  const n = pts.length;
  let d = "";
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const v1 = norm(sub(prev, curr));
    const v2 = norm(sub(next, curr));
    const rr = Math.min(r, dist(prev, curr) / 2, dist(next, curr) / 2);
    const p1 = [curr[0] + v1[0] * rr, curr[1] + v1[1] * rr];
    const p2 = [curr[0] + v2[0] * rr, curr[1] + v2[1] * rr];
    d += i === 0 ? `M ${p1[0]} ${p1[1]} ` : `L ${p1[0]} ${p1[1]} `;
    d += `Q ${curr[0]} ${curr[1]} ${p2[0]} ${p2[1]} `;
  }
  return d + "Z";
}

/* ---------- internal-edge detection & desk-desk snap ---------- */
function computeInternalEdges(desks) {
  const n = desks.length;
  const internal = desks.map(() => ({ short: false, rightLeg: false, long: false, leftLeg: false }));
  const edgesWorld = desks.map((p) => EDGE_DEFS.map((ed) => edgeWorld(p, ed)));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let ei = 0; ei < 4; ei++) {
        for (let ej = 0; ej < 4; ej++) {
          if (Math.abs(EDGE_DEFS[ei].len - EDGE_DEFS[ej].len) > 0.1) continue;
          if (edgesCoincident(edgesWorld[i][ei], edgesWorld[j][ej])) {
            internal[i][EDGE_DEFS[ei].name] = true;
            internal[j][EDGE_DEFS[ej].name] = true;
          }
        }
      }
    }
  }
  return internal;
}
function tryCornerSnap(desk, others, tol = CORNER_SNAP) {
  const verts = deskPolygon(desk);
  let best = null,
    bestDist = tol;
  others.forEach((o) => {
    const overts = deskPolygon(o);
    verts.forEach((v) => {
      overts.forEach((ov) => {
        const d = dist(v, ov);
        if (d < bestDist) {
          bestDist = d;
          best = { dx: ov[0] - v[0], dy: ov[1] - v[1] };
        }
      });
    });
  });
  return best;
}
function tryEdgeSnap(desk, others, tol = EDGE_SNAP) {
  const pieceEdges = EDGE_DEFS.map((ed) => ({ ...ed, world: edgeWorld(desk, ed) }));
  let best = null,
    bestDist = tol;
  others.forEach((other) => {
    const otherEdges = EDGE_DEFS.map((ed) => ({ ...ed, world: edgeWorld(other, ed) }));
    pieceEdges.forEach((pe) => {
      otherEdges.forEach((oe) => {
        if (Math.abs(pe.len - oe.len) > 0.1) return;
        const pDir = norm(sub(pe.world[1], pe.world[0]));
        const oDir = norm(sub(oe.world[1], oe.world[0]));
        const dot = pDir[0] * oDir[0] + pDir[1] * oDir[1];
        if (Math.abs(dot) < 0.98) return;
        const pMid = mid(pe.world[0], pe.world[1]);
        const oMid = mid(oe.world[0], oe.world[1]);
        const d = dist(pMid, oMid);
        if (d < bestDist) {
          bestDist = d;
          best = { dx: oMid[0] - pMid[0], dy: oMid[1] - pMid[1] };
        }
      });
    });
  });
  return best;
}
function deskOverlapsAny(desk, others) {
  const poly = deskPolygon(desk);
  return others.some((o) => satOverlap(poly, deskPolygon(o)));
}
// the smallest width/height the room can shrink to without any existing desk or
// chair sticking out through a wall, given their current positions
function minRoomSizeFor(desks, chairs) {
  let maxX = 0,
    maxY = 0;
  desks.forEach((d) => {
    deskPolygon(d).forEach(([x, y]) => {
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });
  });
  chairs.forEach((c) => {
    const angle = chairDeskAngleRad(c.x, c.y, desks);
    rectVerts(c.x, c.y, angle, 1, 1).forEach(([x, y]) => {
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    });
  });
  const round = (v) => Math.ceil(v * 10) / 10; // round up to 10cm so floating point never leaves things clipped
  return { minW: Math.max(1, round(maxX)), minH: Math.max(1, round(maxY)) };
}
// keep room dimensions locked to a clean 0.5m grid
const snapHalf = (v) => Math.round(v * 2) / 2; // nearest 0.5
const ceilHalf = (v) => Math.ceil(v * 2) / 2; // round up to 0.5 (for min bound)
function deskOutOfRoom(desk, roomW, roomH) {
  const eps = 1e-6;
  return deskPolygon(desk).some(([x, y]) => x < -eps || x > roomW + eps || y < -eps || y > roomH + eps);
}
function deskOverlapsChairSquares(desk, chairSquares) {
  const poly = deskPolygon(desk);
  return chairSquares.some((sq) => satOverlap(poly, sq));
}

/* ---------- doors (placed on room walls) ---------- */
function wallDefs(roomW, roomH) {
  return [
    { key: "top", p1: [0, 0], p2: [roomW, 0], len: roomW, normal: [0, 1] },
    { key: "right", p1: [roomW, 0], p2: [roomW, roomH], len: roomH, normal: [-1, 0] },
    { key: "bottom", p1: [roomW, roomH], p2: [0, roomH], len: roomW, normal: [0, -1] },
    { key: "left", p1: [0, roomH], p2: [0, 0], len: roomH, normal: [1, 0] },
  ];
}
function doorGeom(door, roomW, roomH) {
  const w = wallDefs(roomW, roomH).find((w) => w.key === door.wall);
  const len = w.len;
  const offset = Math.max(0, Math.min(door.offset, len - DOOR_WIDTH));
  const dir = norm(sub(w.p2, w.p1));
  const p1 = [w.p1[0] + dir[0] * offset, w.p1[1] + dir[1] * offset];
  const p2 = [w.p1[0] + dir[0] * (offset + DOOR_WIDTH), w.p1[1] + dir[1] * (offset + DOOR_WIDTH)];
  return { p1, p2, dir, normal: w.normal, wallKey: w.key };
}
function nearestWallPlacement(pt, roomW, roomH) {
  let best = null,
    bestD = Infinity;
  wallDefs(roomW, roomH).forEach((w) => {
    const dir = norm(sub(w.p2, w.p1));
    const rel = sub(pt, w.p1);
    let t = rel[0] * dir[0] + rel[1] * dir[1] - DOOR_WIDTH / 2;
    t = Math.max(0, Math.min(t, w.len - DOOR_WIDTH));
    const center = [w.p1[0] + dir[0] * (t + DOOR_WIDTH / 2), w.p1[1] + dir[1] * (t + DOOR_WIDTH / 2)];
    const d = dist(pt, center);
    if (d < bestD) {
      bestD = d;
      best = { wall: w.key, offset: t };
    }
  });
  return best;
}
function doorsOverlap(d1, d2, roomW, roomH) {
  if (d1.wall !== d2.wall) return false;
  const len = wallDefs(roomW, roomH).find((w) => w.key === d1.wall).len;
  const o1 = Math.max(0, Math.min(d1.offset, len - DOOR_WIDTH));
  const o2 = Math.max(0, Math.min(d2.offset, len - DOOR_WIDTH));
  return !(o1 + DOOR_WIDTH <= o2 + OVERLAP_EPS || o2 + DOOR_WIDTH <= o1 + OVERLAP_EPS);
}
function findDefaultDoorSlot(doors, roomW, roomH) {
  for (const w of wallDefs(roomW, roomH)) {
    for (let off = 0; off <= w.len - DOOR_WIDTH + 1e-6; off += DOOR_WIDTH) {
      const candidate = { wall: w.key, offset: off };
      if (!doors.some((d) => doorsOverlap(d, candidate, roomW, roomH))) return candidate;
    }
  }
  return null;
}

/* ---------- chair attach points (candidates only, chairs are independent objects) ---------- */
function chairFitsInRoom(chairCenter, frontAngleDeg, roomW, roomH) {
  const rad = (frontAngleDeg * Math.PI) / 180;
  const corners = rectVerts(chairCenter[0], chairCenter[1], rad, 1, 1);
  const eps = 1e-6;
  return corners.every(([x, y]) => x >= -eps && x <= roomW + eps && y >= -eps && y <= roomH + eps);
}
function chairPointClearOfOtherDesks(point, desks) {
  const rad = (point.frontAngleDeg * Math.PI) / 180;
  const sq = rectVerts(point.chairCenter[0], point.chairCenter[1], rad, 1, 1);
  return !desks.some((d) => d.id !== point.deskId && satOverlap(sq, deskPolygon(d)));
}
function deskAttachPointsRaw(desk) {
  return ATTACH_POINTS.map((ap) => {
    const m = worldPoint(ap.localMid, desk);
    const outAngleDeg = ap.outAngle + desk.rot;
    const outRad = (outAngleDeg * Math.PI) / 180;
    const chairCenter = [m[0] + Math.cos(outRad) * 0.5, m[1] + Math.sin(outRad) * 0.5];
    const frontAngleDeg = (outAngleDeg + 180 + 360) % 360;
    return { key: ap.key, chairCenter, frontAngleDeg };
  });
}
// when a desk moves or rotates, carry along any chairs that were sitting at one of its attach
// points — same point (short/leg/long-L/C/R), and the chair keeps its relative facing
function reattachChairs(prevDesk, nextDesk, chairs) {
  const oldPts = deskAttachPointsRaw(prevDesk);
  const newPts = deskAttachPointsRaw(nextDesk);
  return chairs.map((c) => {
    const match = oldPts.find((p) => dist(p.chairCenter, [c.x, c.y]) < 0.01);
    if (!match) return c;
    const newPt = newPts.find((p) => p.key === match.key);
    if (!newPt) return c;
    return { ...c, x: newPt.chairCenter[0], y: newPt.chairCenter[1], rot: newPt.frontAngleDeg };
  });
}
// checks that any chairs carried along by a desk's move/rotation don't end up overlapping
// a wall, another desk, or another chair at their new spot
function attachedChairsOk(oldDesk, candidateDesk, chairs, allDesks, roomW, roomH) {
  const moved = reattachChairs(oldDesk, candidateDesk, chairs);
  const desksSub = allDesks.map((d) => (d.id === candidateDesk.id ? candidateDesk : d));
  const movedSquares = moved.map((c) => rectVerts(c.x, c.y, chairDeskAngleRad(c.x, c.y, desksSub), 1, 1));
  for (let i = 0; i < chairs.length; i++) {
    const orig = chairs[i];
    const m = moved[i];
    if (Math.abs(m.x - orig.x) < 1e-9 && Math.abs(m.y - orig.y) < 1e-9) continue; // this chair wasn't carried along
    const sq = movedSquares[i];
    const eps = 1e-6;
    if (!sq.every(([x, y]) => x >= -eps && x <= roomW + eps && y >= -eps && y <= roomH + eps)) return false;
    if (desksSub.some((d) => d.id !== candidateDesk.id && satOverlap(sq, deskPolygon(d)))) return false;
    if (movedSquares.some((sq2, j) => j !== i && satOverlap(sq, sq2))) return false;
  }
  return true;
}
function attachPointsList(desks) {
  const internal = computeInternalEdges(desks);
  const pts = [];
  desks.forEach((desk, i) => {
    ATTACH_POINTS.forEach((ap) => {
      if (internal[i][ap.parentEdge]) return;
      const m = worldPoint(ap.localMid, desk);
      const outAngleDeg = ap.outAngle + desk.rot;
      const outRad = (outAngleDeg * Math.PI) / 180;
      const chairCenter = [m[0] + Math.cos(outRad) * 0.5, m[1] + Math.sin(outRad) * 0.5];
      const frontAngleDeg = (outAngleDeg + 180 + 360) % 360;
      pts.push({ deskId: desk.id, key: ap.key, chairCenter, frontAngleDeg });
    });
  });
  return pts;
}

/* ---------- metrics ---------- */
function nearestDeskIdx(chair, desks) {
  let best = -1,
    bestD = Infinity;
  desks.forEach((d, i) => {
    const dd = dist([chair.x, chair.y], [d.x, d.y]);
    if (dd < bestD) {
      bestD = dd;
      best = i;
    }
  });
  return best;
}
function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}
// finds the point that best fits the intersection of several gaze lines (least-squares), then
// scores how tightly they actually converge there. Returns null if there are fewer than 2 seats
// or all the lines are parallel (no well-defined intersection).
// returns { point, avgDist } where avgDist is the "effective" average distance used to derive
// the 0–1 score; avgDist === Infinity means "treat as 0 score" (nothing meaningful converges)
function gazeLineConvergence(seatsSubset) {
  if (seatsSubset.length < 2) return { point: null, avgDist: Infinity }; // nobody to converge with
  // average perpendicular distance (with a facing-away penalty) from a candidate point to every
  // seat's gaze line — shared by both the well-conditioned least-squares point and the degenerate
  // fallback point below
  function avgDistFrom(point) {
    const [X, Y] = point;
    let sumDist = 0;
    seatsSubset.forEach((s) => {
      const dx = Math.cos(s.facingAngle),
        dy = Math.sin(s.facingAngle);
      const [px, py] = s.chairCenter;
      const vx = X - px,
        vy = Y - py;
      const proj = vx * dx + vy * dy;
      const perpX = vx - proj * dx,
        perpY = vy - proj * dy;
      let d = Math.hypot(perpX, perpY);
      if (proj < 0) d += Math.abs(proj); // the point is behind this seat — it's facing away, not converging, so penalize it further
      sumDist += d;
    });
    return sumDist / seatsSubset.length;
  }
  let Axx = 0,
    Axy = 0,
    Ayy = 0,
    bx = 0,
    by = 0;
  seatsSubset.forEach((s) => {
    const dx = Math.cos(s.facingAngle),
      dy = Math.sin(s.facingAngle);
    // (I - d·dᵀ) projects a vector onto the plane perpendicular to this seat's gaze direction
    const m00 = 1 - dx * dx,
      m01 = -dx * dy,
      m11 = 1 - dy * dy;
    Axx += m00;
    Axy += m01;
    Ayy += m11;
    const [px, py] = s.chairCenter;
    bx += m00 * px + m01 * py;
    by += m01 * px + m11 * py;
  });
  const det = Axx * Ayy - Axy * Axy;
  if (Math.abs(det) < 1e-9) {
    // every gaze line is mutually parallel, so there's no unique least-squares intersection.
    // "parallel" covers several different real situations though:
    //  - everyone facing the exact same way → never converges, score 0
    //  - exactly two seats lined up on their shared axis and facing one another (a narrow table)
    //    → about as converged as it gets, score 1
    //  - anything else parallel (offset "passing by", back-to-back, etc.) → there's no single
    //    intersection, but there IS a natural "center of the group" to judge each gaze line
    //    against — use the seats' centroid as a stand-in target point.
    const dirs = seatsSubset.map((s) => [Math.cos(s.facingAngle), Math.sin(s.facingAngle)]);
    const allSameDirection = dirs.every((d) => d[0] * dirs[0][0] + d[1] * dirs[0][1] > 0.999);
    if (allSameDirection) return { point: null, avgDist: Infinity };
    if (seatsSubset.length === 2) {
      const [a, b] = seatsSubset;
      const sep = [b.chairCenter[0] - a.chairCenter[0], b.chairCenter[1] - a.chairCenter[1]];
      const sepLen = Math.hypot(sep[0], sep[1]);
      if (sepLen > 1e-6) {
        const sepDir = [sep[0] / sepLen, sep[1] / sepLen];
        const da = dirs[0],
          db = dirs[1];
        const aTowardB = da[0] * sepDir[0] + da[1] * sepDir[1];
        const bTowardA = db[0] * -sepDir[0] + db[1] * -sepDir[1];
        if (aTowardB > 0.95 && bTowardA > 0.95) {
          return { point: [(a.chairCenter[0] + b.chairCenter[0]) / 2, (a.chairCenter[1] + b.chairCenter[1]) / 2], avgDist: 0 };
        }
      }
    }
    const cx = seatsSubset.reduce((s, seat) => s + seat.chairCenter[0], 0) / seatsSubset.length;
    const cy = seatsSubset.reduce((s, seat) => s + seat.chairCenter[1], 0) / seatsSubset.length;
    return { point: [cx, cy], avgDist: avgDistFrom([cx, cy]) };
  }
  const X = (bx * Ayy - by * Axy) / det;
  const Y = (Axx * by - Axy * bx) / det;
  return { point: [X, Y], avgDist: avgDistFrom([X, Y]) };
}
// average perpendicular distance (meters) from the fitted point at/above which convergence
// is scored as 0 — i.e. how loosely "converging" still counts as converging at all
const GAZE_CONVERGENCE_NORM = 1.5;

function computeMetrics(desks, chairs, roomW, roomH) {
  if (desks.length === 0) return null;
  const roomArea = roomW * roomH;
  const deskPolys = desks.map((d) => deskPolygon(d));
  const deskArea = deskPolys.reduce((s, poly) => s + polygonArea(poly), 0);

  const seats = chairs.map((c) => {
    const facingRad = (c.rot * Math.PI) / 180;
    return {
      chairCenter: [c.x, c.y],
      facingAngle: facingRad,
      wsPoly: seatWorkspacePoly(c.x, c.y, c.rot, desks),
    };
  });

  const seatCount = seats.length;
  const seatEfficiency = roomArea > 0 ? Math.min(1, (seatCount / roomArea) * 4) : 0;
  const openness = roomArea > 0 ? Math.max(0, 1 - deskArea / roomArea) : 0;

  let clearCount = 0;
  seats.forEach((seat, idx) => {
    let blocked = false;
    for (let j = 0; j < seats.length && !blocked; j++) {
      if (j === idx) continue;
      if (satOverlap(seat.wsPoly, seats[j].wsPoly, 0)) blocked = true;
    }
    if (!blocked) clearCount++;
  });
  const concentration = seatCount > 0 ? clearCount / seatCount : 0;

  // 作業しやすさ: 各席の作業スペース(1m × H の長方形)のうち「実質的に使える」広さの割合。
  // 他の人と被っている場所は使えなくなるのではなく、被っている人数で公平に分け合う
  // (2人が完全に被っていれば、お互い50%ずつ使える、という考え方)。机からはみ出て床の上に
  // かかっている部分は、机がない=使える作業面がないので0点として扱う。長方形内をグリッドで
  // サンプリングして概算する。
  const WORKSPACE_GRID = 8;
  let workabilitySum = 0;
  seats.forEach((seat, idx) => {
    const fwd = [Math.cos(seat.facingAngle), Math.sin(seat.facingAngle)];
    const right = [-Math.sin(seat.facingAngle), Math.cos(seat.facingAngle)];
    const center = [seat.chairCenter[0] + fwd[0] * (0.5 + H / 2), seat.chairCenter[1] + fwd[1] * (0.5 + H / 2)];
    const hw = 0.5,
      hd = H / 2;
    let creditSum = 0,
      total = 0;
    for (let gu = 0; gu < WORKSPACE_GRID; gu++) {
      for (let gv = 0; gv < WORKSPACE_GRID; gv++) {
        const u = -hw + (hw * 2 * (gu + 0.5)) / WORKSPACE_GRID;
        const v = -hd + (hd * 2 * (gv + 0.5)) / WORKSPACE_GRID;
        const px = center[0] + u * right[0] + v * fwd[0];
        const py = center[1] + u * right[1] + v * fwd[1];
        total++;
        const onDesk = deskPolys.some((poly) => pointInPolygon([px, py], poly));
        if (!onDesk) continue; // no physical desk surface here — not usable, contributes 0
        let occupants = 1; // this seat itself
        seats.forEach((other, j) => {
          if (j !== idx && pointInPolygon([px, py], other.wsPoly)) occupants++;
        });
        creditSum += 1 / occupants;
      }
    }
    workabilitySum += total > 0 ? creditSum / total : 1;
  });
  const workability = seatCount > 0 ? workabilitySum / seatCount : 0;

  let talkCount = 0;
  seats.forEach((s1, i) => {
    let hasPartner = false;
    seats.forEach((s2, j) => {
      if (i === j || hasPartner) return;
      const dx = s2.chairCenter[0] - s1.chairCenter[0];
      const dy = s2.chairCenter[1] - s1.chairCenter[1];
      const d = Math.hypot(dx, dy);
      if (d < 0.6 || d > 4) return;
      const angTo = Math.atan2(dy, dx);
      const diff1 = angleDiff(s1.facingAngle, angTo);
      const angBack = Math.atan2(-dy, -dx);
      const diff2 = angleDiff(s2.facingAngle, angBack);
      if (diff1 < Math.PI / 2.5 && diff2 < Math.PI / 2.5) hasPartner = true;
    });
    if (hasPartner) talkCount++;
  });
  const talkability = seatCount > 0 ? talkCount / seatCount : 0;

  const n = desks.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (a, b) => {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  let connections = 0;
  // two desks are considered part of the same "island" if their polygons are touching (within
  // the same tolerance used for snapping desks together) — regardless of which specific edges
  // are involved or whether those edges are the same length. Requiring matching edge lengths
  // was missing real islands whenever, say, a desk's long edge met a neighbor's short edge.
  const JOIN_TOL = 0.05;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (polyMinDist(deskPolys[i], deskPolys[j]) < JOIN_TOL) {
        union(i, j);
        connections++;
      }
    }
  }
  const clusterMap = {};
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!clusterMap[r]) clusterMap[r] = [];
    clusterMap[r].push(i);
  }
  const clusters = Object.values(clusterMap);
  const walls = [
    [[0, 0], [roomW, 0]],
    [[roomW, 0], [roomW, roomH]],
    [[roomW, roomH], [0, roomH]],
    [[0, roomH], [0, 0]],
  ];
  let moveSum = 0;
  clusters.forEach((cluster) => {
    let minGap = Infinity;
    clusters.forEach((other) => {
      if (other === cluster) return;
      cluster.forEach((i) => {
        other.forEach((j) => {
          const d = polyMinDist(deskPolys[i], deskPolys[j]);
          if (d < minGap) minGap = d;
        });
      });
    });
    cluster.forEach((i) => {
      walls.forEach(([p1, p2]) => {
        const d = polySegMinDist(deskPolys[i], p1, p2);
        if (d < minGap) minGap = d;
      });
    });
    if (!isFinite(minGap)) minGap = 1.5;
    moveSum += Math.min(minGap / 1.0, 1);
  });
  const movement = clusters.length > 0 ? moveSum / clusters.length : 0;

  // 独創性: 机の集合を1つの図形として見たときの、実際の輪郭の辺の数に基づくスコア。以前は
  // 「机がくっつくたびに輪郭から2辺隠れる」という近似式 → 点サンプリング → 平行な辺同士の
  // 区間演算、と順に試したが、机同士が平行でない角度で重なり合うケース(辺が斜めに交差する)
  // を正しく扱えていなかった。今回は各辺について、他のどの机の境界とも交差する点をすべて
  // 求めて分割し、それぞれの区間の中点が他の机の内部にあるかどうかで露出/被覆を判定する。
  // 平行な辺同士がぴったり重なるケースも、斜めに交差するケースも、どちらも同じ枠組みで
  // 正しく扱える。
  const MIN_EDGE_LEN = 0.08; // これより短い露出区間はスナップの誤差とみなして無視する(m)
  function segIntersectT(a, b, c, d) {
    // t along [a,b] where it crosses segment [c,d]; null if they don't cross (parallel included)
    const rx = b[0] - a[0],
      ry = b[1] - a[1];
    const sx = d[0] - c[0],
      sy = d[1] - c[1];
    const rxs = rx * sy - ry * sx;
    if (Math.abs(rxs) < 1e-9) return null;
    const qpx = c[0] - a[0],
      qpy = c[1] - a[1];
    const t = (qpx * sy - qpy * sx) / rxs;
    const u = (qpx * ry - qpy * rx) / rxs;
    if (t < -1e-7 || t > 1 + 1e-7 || u < -1e-7 || u > 1 + 1e-7) return null;
    return Math.max(0, Math.min(1, t));
  }
  // strict point-in-polygon treats a point sitting exactly on (or a few ULPs from) the boundary
  // as ambiguous/outside, which happens constantly here — a sub-segment's midpoint is often
  // exactly where two desks' edges coincide (e.g. the middle of a fully-shared edge). Treat
  // "on or very close to another desk's boundary" as covered too, not just "strictly inside".
  function pointNearOrInPolygon(pt, poly, tol) {
    if (pointInPolygon(pt, poly)) return true;
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const a = poly[i],
        b = poly[(i + 1) % n];
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy || 1e-18;
      let t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a[0] + t * dx,
        py = a[1] + t * dy;
      if (Math.hypot(pt[0] - px, pt[1] - py) < tol) return true;
    }
    return false;
  }
  const outlineSegments = []; // { p1, p2 } — the actual exposed pieces, before merging straight runs
  deskPolys.forEach((poly, di) => {
    const vcount = poly.length;
    for (let i = 0; i < vcount; i++) {
      const a = poly[i],
        b = poly[(i + 1) % vcount];
      const edgeLen = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
      // gather every t-value where this edge crosses another desk's boundary — from a true
      // crossing (angled overlap) or from the endpoints of a parallel-collinear overlap
      const breaks = new Set([0, 1]);
      deskPolys.forEach((otherPoly, oi) => {
        if (oi === di) return;
        const ovcount = otherPoly.length;
        for (let j = 0; j < ovcount; j++) {
          const c = otherPoly[j],
            d = otherPoly[(j + 1) % ovcount];
          // check "are these two edges close enough to parallel to treat as collinear-overlap"
          // FIRST, using a generous angular tolerance — real desk placements from dragging/
          // rotating are essentially never bit-exact parallel, so relying on an exact intersection
          // formula (which divides by a near-zero cross product) for "almost parallel" edges is
          // numerically unstable. Route anything within ~1° of parallel through the robust
          // projection-based overlap check instead of the crossing-point formula.
          const rx = b[0] - a[0],
            ry = b[1] - a[1];
          const rlen = Math.hypot(rx, ry) || 1e-9;
          const dirx = rx / rlen,
            diry = ry / rlen;
          const sx = d[0] - c[0],
            sy = d[1] - c[1];
          const slen = Math.hypot(sx, sy) || 1e-9;
          const sinAngle = Math.abs(dirx * (sy / slen) - diry * (sx / slen));
          if (sinAngle < 0.02) {
            // near-parallel: only meaningful if also collinear (close to the same line)
            const perp = (p) => {
              const vx = p[0] - a[0],
                vy = p[1] - a[1];
              const proj = vx * dirx + vy * diry;
              return Math.hypot(vx - proj * dirx, vy - proj * diry);
            };
            if (perp(c) > 0.03 || perp(d) > 0.03) continue; // not on the same line
            const tOf = (p) => {
              const vx = p[0] - a[0],
                vy = p[1] - a[1];
              return (vx * dirx + vy * diry) / rlen;
            };
            let t0 = tOf(c),
              t1 = tOf(d);
            if (t0 > t1) [t0, t1] = [t1, t0];
            t0 = Math.max(0, Math.min(1, t0));
            t1 = Math.max(0, Math.min(1, t1));
            if (t1 > t0) {
              breaks.add(t0);
              breaks.add(t1);
            }
            continue;
          }
          const t = segIntersectT(a, b, c, d);
          if (t !== null) breaks.add(t);
        }
      });
      const sorted = Array.from(breaks).sort((p, q) => p - q);
      let runStartT = null;
      const pointAt = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      for (let k = 0; k < sorted.length - 1; k++) {
        const t0 = sorted[k],
          t1 = sorted[k + 1];
        if (t1 - t0 < 1e-7) continue;
        const tm = (t0 + t1) / 2;
        const mx = a[0] + (b[0] - a[0]) * tm;
        const my = a[1] + (b[1] - a[1]) * tm;
        const covered = deskPolys.some((otherPoly, oi) => oi !== di && pointNearOrInPolygon([mx, my], otherPoly, 0.005));
        if (!covered) {
          if (runStartT === null) runStartT = t0;
        } else if (runStartT !== null) {
          const runLen = (t0 - runStartT) * edgeLen;
          if (runLen >= MIN_EDGE_LEN) outlineSegments.push({ p1: pointAt(runStartT), p2: pointAt(t0) });
          runStartT = null;
        }
      }
      if (runStartT !== null) {
        const runLen = (1 - runStartT) * edgeLen;
        if (runLen >= MIN_EDGE_LEN) outlineSegments.push({ p1: pointAt(runStartT), p2: pointAt(1) });
      }
    }
  });
  // two exposed segments — even from different desks — that meet end-to-end and point the same
  // direction form a straight line with no actual turn, so a person wouldn't perceive a corner
  // there. Repeatedly merge any such pair until no more merges are possible.
  const MERGE_POINT_TOL = 0.01,
    MERGE_ANGLE_TOL = 0.03;
  function pointsClose(p, q) {
    return Math.hypot(p[0] - q[0], p[1] - q[1]) < MERGE_POINT_TOL;
  }
  function segDir(s) {
    const dx = s.p2[0] - s.p1[0],
      dy = s.p2[1] - s.p1[1];
    const len = Math.hypot(dx, dy) || 1e-9;
    return [dx / len, dy / len];
  }
  function tryMerge(s1, s2) {
    const d1 = segDir(s1),
      d2 = segDir(s2);
    if (Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) > MERGE_ANGLE_TOL) return null; // not collinear
    const dot = d1[0] * d2[0] + d1[1] * d2[1];
    if (dot > 0) {
      // same direction: s1 continuing into s2, or s2 continuing into s1
      if (pointsClose(s1.p2, s2.p1)) return { p1: s1.p1, p2: s2.p2 };
      if (pointsClose(s1.p1, s2.p2)) return { p1: s2.p1, p2: s1.p2 };
    } else {
      // opposite direction: only a real straight continuation if they meet at matching ends
      // (i.e. s2 is effectively s1's mirror continuing outward the other way), not a "there and
      // back" reversal along the same line — which would otherwise collapse into a near-zero-length
      // spurious segment
      if (pointsClose(s1.p2, s2.p2)) return { p1: s1.p1, p2: s2.p1 };
      if (pointsClose(s1.p1, s2.p1)) return { p1: s1.p2, p2: s2.p2 };
    }
    return null;
  }
  let mergedAny = true;
  while (mergedAny) {
    mergedAny = false;
    outer: for (let i = 0; i < outlineSegments.length; i++) {
      for (let j = 0; j < outlineSegments.length; j++) {
        if (i === j) continue;
        const merged = tryMerge(outlineSegments[i], outlineSegments[j]);
        if (!merged) continue;
        outlineSegments[i] = merged;
        outlineSegments.splice(j, 1);
        mergedAny = true;
        break outer;
      }
    }
  }
  const outlineEdgeCount = outlineSegments.length;
  // calibrated so a single isolated desk (4 exposed edges) sits near 0%, and a shape with
  // roughly 12 desks' worth of fully-exposed edges (48) reaches 100%
  const originality = n > 0 ? clamp01((outlineEdgeCount - 4) / 44) : 0;
  const isolatedDesks = clusters.filter((c) => c.length === 1).length;

  // which desk (by index) each chair is actually seated at, matched by exact attach-point
  // position — same matching rule used everywhere else a chair needs to be tied to its desk
  const chairOwnerIndex = chairs.map((c) => {
    for (let i = 0; i < n; i++) {
      const pts = deskAttachPointsRaw(desks[i]);
      if (pts.some((p) => dist(p.chairCenter, [c.x, c.y]) < 0.01)) return i;
    }
    return -1;
  });
  const islands = clusters.map((cluster) => {
    const deskSet = new Set(cluster);
    const islandSeats = seats.filter((s, idx) => deskSet.has(chairOwnerIndex[idx]));
    const conv = gazeLineConvergence(islandSeats);
    const gazeConvergence = clamp01(1 - conv.avgDist / GAZE_CONVERGENCE_NORM);
    return { deskCount: cluster.length, chairCount: islandSeats.length, gazeConvergence };
  });
  const totalIslandChairs = islands.reduce((s, isl) => s + isl.chairCount, 0);
  const gazeFocus = totalIslandChairs > 0 ? islands.reduce((s, isl) => s + isl.gazeConvergence * isl.chairCount, 0) / totalIslandChairs : null;
  // 話しやすさ＝視線の集まり具合。ペアの向かい合わせ判定(旧talkability)はもう使わず、
  // 島全体で視線がどれだけ一点に集まっているかだけで決める。
  const talkabilityCombined = gazeFocus;

  return {
    seatCount,
    deskCount: n,
    seatEfficiency,
    openness,
    concentration,
    workability,
    talkability,
    talkabilityCombined,
    movement,
    connections,
    originality,
    outlineEdgeCount,
    isolatedDesks,
    clusterCount: clusters.length,
    islands,
    gazeFocus,
  };
}
function squareVerts(cx, cy, angle, size) {
  const h = size / 2;
  const corners = [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ];
  return corners.map(([lx, ly]) => [
    lx * Math.cos(angle) - ly * Math.sin(angle) + cx,
    lx * Math.sin(angle) + ly * Math.cos(angle) + cy,
  ]);
}
function rectVerts(cx, cy, angle, width, depth) {
  const hw = width / 2,
    hd = depth / 2;
  const fwd = [Math.cos(angle), Math.sin(angle)];
  const right = [-Math.sin(angle), Math.cos(angle)];
  const corners = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  return corners.map(([u, v]) => [cx + u * right[0] + v * fwd[0], cy + u * right[1] + v * fwd[1]]);
}
// workspace: assume the chair occupies a 1x1 seat square (radius 0.5) around its center;
// the workspace is a 1 x H rectangle flush against that square's front edge.
function seatWorkspacePoly(chairX, chairY, rotDeg, desks) {
  const facingRad = (rotDeg * Math.PI) / 180;
  const center = [chairX + Math.cos(facingRad) * (0.5 + H / 2), chairY + Math.sin(facingRad) * (0.5 + H / 2)];
  return rectVerts(center[0], center[1], facingRad, 1, H);
}
function triangleStr(cxPx, cyPx, rotDeg, R) {
  const rad = (rotDeg * Math.PI) / 180;
  const tip = [cxPx + Math.cos(rad) * R * 0.85, cyPx + Math.sin(rad) * R * 0.85];
  const perp = [-Math.sin(rad), Math.cos(rad)];
  const back = [cxPx - Math.cos(rad) * R * 0.35, cyPx - Math.sin(rad) * R * 0.35];
  const w = R * 0.55;
  const b1 = [back[0] + perp[0] * w, back[1] + perp[1] * w];
  const b2 = [back[0] - perp[0] * w, back[1] - perp[1] * w];
  return `${tip.join(",")} ${b1.join(",")} ${b2.join(",")}`;
}

/* ---------- UI ---------- */
const pct = (v) => `${Math.round(v * 100)}%`;
const ACCENT = "#1A1A1A";
const CHART_BLUE = "#2F6FED"; // the radar chart keeps its blue even though the rest of the UI is monochrome
function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E7E7E4", borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <Icon size={13} color="#9A9A94" />
        <span style={{ fontSize: 11, color: "#9A9A94", letterSpacing: 0.3 }}>{label}</span>
      </div>
      <div style={{ fontSize: 21, color: "#1A1A1A", lineHeight: 1, fontWeight: 600 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: "#B4B4AE", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}
function StatRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "#4A4A46", padding: "3px 0" }}>
      <span style={{ color: "#9A9A94" }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}
// 5-axis radar (pentagon) chart. `axes` is an array of { label, value } with value in 0..1.
const RADAR_AXIS_MS = 450; // ms for one axis to grow from 0 to its value
const RADAR_GAP_MS = 90; // pause between axes
const RADAR_STEP_MS = RADAR_AXIS_MS + RADAR_GAP_MS;
function radarTotalDuration(axisCount) {
  return axisCount * RADAR_STEP_MS;
}
function RadarChart({ axes, size = 360, onComplete }) {
  const cx = size / 2,
    cy = size / 2 - 4;
  const maxR = size * 0.19; // keep the pentagon itself smaller so labels have room around it
  const n = axes.length;
  // reveal axes one at a time: each grows from 0 to its value over RADAR_AXIS_MS, then the next starts
  const AXIS_MS = RADAR_AXIS_MS;
  const STEP_MS = RADAR_STEP_MS;
  const [progress, setProgress] = useState(() => axes.map(() => 0));
  const valuesKey = axes.map((a) => a.value).join(",");
  useEffect(() => {
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(() => fn(Date.now()), 16);
    const caf = typeof cancelAnimationFrame === "function" ? cancelAnimationFrame : clearTimeout;
    let handle;
    const start = (typeof performance !== "undefined" ? performance : Date).now();
    function tick(now) {
      const elapsed = now - start;
      setProgress(
        axes.map((_, i) => {
          const t = (elapsed - i * STEP_MS) / AXIS_MS;
          return Math.max(0, Math.min(1, t));
        })
      );
      if (elapsed < n * STEP_MS) {
        handle = raf(tick);
      } else if (onComplete) {
        onComplete();
      }
    }
    handle = raf(tick);
    return () => caf(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuesKey, n]);
  const angleOf = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i, v) => {
    const angle = angleOf(i);
    const r = maxR * Math.max(0, Math.min(1, v));
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  };
  // point at a fixed pixel radius beyond the pentagon, rather than a multiple of maxR — keeps
  // spacing consistent regardless of how big the pentagon itself is
  const ptFixed = (i, extraR) => {
    const angle = angleOf(i);
    return [cx + (maxR + extraR) * Math.cos(angle), cy + (maxR + extraR) * Math.sin(angle)];
  };
  const anchorFor = (i) => {
    const cosA = Math.cos(angleOf(i));
    if (cosA > 0.3) return "start";
    if (cosA < -0.3) return "end";
    return "middle";
  };
  const ringLevels = [0.25, 0.5, 0.75, 1];
  const animatedValues = axes.map((a, i) => a.value * progress[i]);
  const dataPts = animatedValues.map((v, i) => pt(i, v));
  const dataPath = dataPts.map((p) => p.join(",")).join(" ");
  // Crop the viewBox to the actual drawn content (pentagon + labels + values) instead of the full
  // square, so the chart isn't a small pentagon floating in a large empty box. The element then
  // hugs that content (via aspect-ratio) so its slot isn't letterboxed either.
  const boundPts = [];
  axes.forEach((a, i) => {
    boundPts.push(pt(i, 1));
    boundPts.push(ptFixed(i, a.valueAbove ? 22 : 46));
    boundPts.push(ptFixed(i, a.valueDirectlyBelowLabel ? (a.valueAbove ? 22 : 46) : a.valueAbove ? 46 : 22));
  });
  let bMinX = Infinity,
    bMinY = Infinity,
    bMaxX = -Infinity,
    bMaxY = -Infinity;
  boundPts.forEach(([x, y]) => {
    if (x < bMinX) bMinX = x;
    if (y < bMinY) bMinY = y;
    if (x > bMaxX) bMaxX = x;
    if (y > bMaxY) bMaxY = y;
  });
  const padX = 46,
    padY = 18; // leave room for the label/value text around each anchor point
  const vbX = bMinX - padX,
    vbY = bMinY - padY;
  const vbW = bMaxX - bMinX + padX * 2,
    vbH = bMaxY - bMinY + padY * 2;
  return (
    <svg viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`} preserveAspectRatio="xMidYMid meet" style={{ display: "block", height: "100%", maxWidth: "100%", aspectRatio: `${vbW} / ${vbH}` }}>
      {ringLevels.map((lv) => {
        const ringPts = axes.map((_, i) => pt(i, lv).join(",")).join(" ");
        return <polygon key={lv} points={ringPts} fill="none" stroke="#E7E7E4" strokeWidth={1} />;
      })}
      {axes.map((a, i) => {
        const [ex, ey] = pt(i, 1);
        return <line key={"axis" + i} x1={cx} y1={cy} x2={ex} y2={ey} stroke="#E7E7E4" strokeWidth={1} />;
      })}
      <polygon points={dataPath} fill="rgba(47,111,237,0.18)" stroke={CHART_BLUE} strokeWidth={2} />
      {dataPts.map((p, i) => (
        <circle key={"dot" + i} cx={p[0]} cy={p[1]} r={3.5} fill={CHART_BLUE} opacity={progress[i] > 0 ? 1 : 0} />
      ))}
      {axes.map((a, i) => {
        const anchor = a.valueDirectlyBelowLabel ? "middle" : anchorFor(i);
        let vx, vy;
        if (a.valueDirectlyBelowLabel) {
          [vx, vy] = ptFixed(i, a.valueAbove ? 22 : 46);
          vy += 16;
        } else {
          [vx, vy] = ptFixed(i, a.valueAbove ? 46 : 22);
        }
        return (
          <text key={"val" + i} x={vx} y={vy} fontSize={11} fill={CHART_BLUE} fontWeight={700} textAnchor={anchor} dominantBaseline="middle">
            {Math.round(animatedValues[i] * 100)}%
          </text>
        );
      })}
      {axes.map((a, i) => {
        const [lx, ly] = ptFixed(i, a.valueAbove ? 22 : 46);
        const anchor = a.valueDirectlyBelowLabel ? "middle" : anchorFor(i);
        return (
          <text key={"label" + i} x={lx} y={ly} fontSize={12} fill="#3A3A36" textAnchor={anchor} dominantBaseline="middle">
            {a.label}
          </text>
        );
      })}
    </svg>
  );
}
// compact, non-interactive overview of the room layout — used at the top of the evaluation screen
function RoomPreview({ desks, chairs, doors, roomW, roomH }) {
  // viewBox is derived purely from the room's own size (meters × a fixed px-per-meter), so the
  // SVG's intrinsic aspect ratio always matches the room, and it can be scaled to fill any
  // container via CSS (width/height 100%) — strokes defined in these units are then always the
  // same proportion of the drawing regardless of room size, with no extra scale-compensation needed
  const PXM = 40;
  const marginM = 0.3;
  const vbW = (roomW + marginM * 2) * PXM;
  const vbH = (roomH + marginM * 2) * PXM;
  const toPxLocal = (m) => m * PXM;
  const offsetX = marginM * PXM;
  const offsetY = marginM * PXM;
  const wallStroke = 2,
    deskStroke = 1.8,
    chairStroke = 1.8,
    doorBgStroke = 4,
    doorTickStroke = 1.4,
    deskCornerRadius = 5;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: "block", background: "#FFFFFF", borderRadius: 10, border: "1px solid #EDEDEA", height: "100%", maxWidth: "100%", aspectRatio: `${vbW} / ${vbH}` }}
    >
      <g transform={`translate(${offsetX},${offsetY})`}>
        <rect x={0} y={0} width={toPxLocal(roomW)} height={toPxLocal(roomH)} fill="#FFFFFF" stroke="#8A8A84" strokeWidth={wallStroke} />
        {desks.map((d) => {
          const poly = deskPolygon(d).map(([x, y]) => [toPxLocal(x), toPxLocal(y)]);
          return <path key={"pd" + d.id} d={roundedPolyPath(poly, deskCornerRadius)} fill="#ECECE8" stroke="#8A8A84" strokeWidth={deskStroke} />;
        })}
        {chairs.map((c) => {
          const r = toPxLocal(CHAIR_RADIUS);
          const cxPx = toPxLocal(c.x),
            cyPx = toPxLocal(c.y);
          return (
            <g key={"pc" + c.id}>
              <circle cx={cxPx} cy={cyPx} r={r} fill="#FFFFFF" stroke="#6B6B66" strokeWidth={chairStroke} />
              <polygon points={triangleStr(cxPx, cyPx, c.rot, r)} fill="#6B6B66" />
            </g>
          );
        })}
        {doors.map((door) => {
          const g = doorGeom(door, roomW, roomH);
          const p1 = [toPxLocal(g.p1[0]), toPxLocal(g.p1[1])];
          const p2 = [toPxLocal(g.p2[0]), toPxLocal(g.p2[1])];
          const tick = toPxLocal(0.15);
          const nrm = [g.normal[0] * tick, g.normal[1] * tick];
          const t1 = [p1[0] + nrm[0], p1[1] + nrm[1]];
          const t2 = [p2[0] + nrm[0], p2[1] + nrm[1]];
          return (
            <g key={"pdoor" + door.id}>
              <line x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke="#FFFFFF" strokeWidth={doorBgStroke} />
              <line x1={p1[0]} y1={p1[1]} x2={t1[0]} y2={t1[1]} stroke="#9A9A94" strokeWidth={doorTickStroke} />
              <line x1={p2[0]} y1={p2[1]} x2={t2[0]} y2={t2[1]} stroke="#9A9A94" strokeWidth={doorTickStroke} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
function btnStyle(primary, disabled) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12.5,
    padding: "7px 12px",
    borderRadius: 6,
    border: primary ? `1px solid ${ACCENT}` : "1px solid #E0E0DC",
    background: disabled ? "#F5F5F3" : primary ? ACCENT : "#FFFFFF",
    color: disabled ? "#C4C4BE" : primary ? "#FFFFFF" : "#4A4A46",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 500,
  };
}
const inputStyle = {
  width: 46,
  background: "#FFFFFF",
  border: "1px solid #E0E0DC",
  borderRadius: 4,
  color: "#1A1A1A",
  fontSize: 12,
  padding: "3px 5px",
};
const stepperBtnStyle = {
  width: 20,
  height: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#FFFFFF",
  border: "1px solid #E0E0DC",
  borderRadius: 4,
  color: "#1A1A1A",
  cursor: "pointer",
  padding: 0,
};

const OKAMURA_FULL_IMG = "data:image/png;base64,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";
const IKETANI_IMG = "data:image/png;base64,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";
const OKAMURA_FACE_IMG = "data:image/png;base64,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";
const ITO_IMG = "data:image/png;base64,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";
const HAMANO_IMG = "data:image/png;base64,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eMApp5zy9luzWrZq4dhOaWnptAenNTTU33ffvYlEwjB0xlgqlWKMGYnE8//59/333z9v3rxDDj3k408+SZWUtKhsAQAdO3ZklC5fthwAampqpkyZMnr0mMcff6yxsckwjLycAb8lAH82JkJaOp12LKdDh45elboYhoc7aRScJUxADTUUHoMcKDUSkjL+/1I1nCRW/Xi5Ri+y5qX7UpwkwZPed0XOf96noQcFGZIK0ofGMzhyZWaaJiFky5bNbdq2mTp1Kje73A6efvppF1544XHH/61v377p5mbTNLk7GCTtJRLBPdcE3EEkhPBBTIyx66//OwC88sorjDHLtmzbJeOrq6s7/fTTAOA///4PpZQb8TvvuhMA7r3nPsuympubpa/48YcfhwwbCgDH/e1vc+fMZYwtW7EUAG684SZK2e7duxljH338CQA8+eRTLu8wdizLnjN33u5d1Xy9POrKL776AgBmvf0OY6ypuUkYuaJgI4uhilSHI3mFJ/GMxug/xXwFgRAqQJxL4tgyimQcNuIVZLgaQDm1T9nzFp6dq5iEGpp/yFPVhNA2bdp279593bp1mUympCSFicXfU129548/1hwz5ZjyiopcLqfpungdjDEASiQS6Uxm9erVq1atsnK5/gMG7L///q1bt+bXTyaSlFKCyb/+9WSvnr369e3LGAMKgJCuG5ZltWjR4vXXXj/wwAO7dOnKL2vZ1n333pfLWW+8+call13asWMHLmrbtm03c9m27doeeNABq1asfOzxJx595OEVy5bNmz9/8KDB+4/af9OmLYyysrIy07KOOurIYcOHPfb4Y+ecc05VVRV2bEzIXXfdcfttdxxz7NG2bSMElDEAqK2p4bo2omiLhcmGAvqGFcrZoHzbEFOxQiA11ujnLRl4qSMfJ4e4vRahypjO2HzpncrnK95fKV4pFjnGi1OVck12xhlnVFRU7Nixg1La0NDAGDvzrLM6dOxY1arq4w8/ppRytnDvmpw8KJ3J/Oupp/v176/l+xgBoHPnzg9Ne4j7bthx8sxsrgZybMe2iWUS08Sm6eRyJk8Jcr3LcVD+LU1NTZSy9z/48Kijjm7dpk2LFi0qyisqKyv326/XA/c/UFfX0NjUtGb1mqbGJozxjp07N27Y6NiOZZrcUX7tjdcB4NFHHmOM1dXV5XLZyUdMeved9zzm8+bmJsbY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";
const ITO_SURPRISED_IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAKAAAADQCAIAAAAPj/27AACUYElEQVR42p19dZwcVdb2ubeq2sZ94q7EE2IkIUCIEAKEBFmcxV0WCYu7sxBgF3dbdHEJhCCBhAjEdeLjPtNScuX741ZVl3Un79c/3n0nM93VVVfOPec5z3kOYowhQIDAfnHO4WAvhJB4G0Io26cQgO/XHDgCJL7UvAgg8XvOuX3BwC+1Pi6+0foCDgDAEQDnSPzBfCcEXY1zjgBcX5TlKex7AwQIkH3D1rfab0Lcuibn3DM4/i8y78P9z/QzcvPrzK+2/uUaLs7FN6bfJsbDvj0OACAjhMTQQvBwuAeXc9cocGCcIetlX4Qx85f2jDqnV9yCOZ32ykLpy9o/YIzdN8YB0he1HhRx4Bw4o0xcULzDHGUOAIAlDIACn875XJl+Yy0KBOLq3Px212INmjN7TAKH1/6r+Fn8U7xcC4775gWZN4ABiycUgwmenQoAHBBjLMuMBm7r9O1y4MCz3Lc9na4JRmA/DAAgjNLvdA9KlgUn3kkp5ZxjLGHseifjDCNs/9MwDM4BY4wRIMCAzHvIYq48e9o7c9zcwRxx75gGDYX9cf8TWYMJAChw66dXD/BAM+A3OeKdCBBHPD3BronJusY9hgsChyho7tPGxzYsnNuTbb/ZY/855wiBeZscAHEAYIwDcFmWASCZTG3ctPGPP1b99dfaHTt2dHR0AufRWLS0pGTU6FGzZ82eMGGiJEmEGLKs2LfBGOWMc4Qwwvb6sL/Xb7RdG85hFT0bMfBTllWx9r3jr4wxzgEjBMgcygArzc3jIL0ZHEeTeSUO3pWGgHOO/LYocHbTa9A+L4E7F1dGMwXIfjDxlaZZc8yiPc3uYTI/Jn7PGAfOEUeMU8pZOBwGgOXLf3v77be//e67XVU7C4pL+vXpXVlRkZefL2HcGe/Yu3dfdXVNc1PTEZMn/+e553v26tne1i5JWFbk/PyCaCRir0Vd1xFCkiz5DoXgLe6xov7j3D/lzhVv/5UxhhBgLFHGEADGONASOO5BfJxZVzanhHMOnCOEhfUy/4oAceTYwfYMWWaHu0/PYMvg+mrX86TtG6QNVOCGCLZd1qLhXDwRZ5wTw5AVWZblZT/9fNcdd/7087KysvKT5s+fNWtWl65dc2PRlJqSZSUvL7eyoiI/vyCRTH77zTf33nvPzp27unXrVltXhzGEQuHi4uLevXsNHzHsyCOnjx45qmvXbmK4GWOSJPmf1G85xbw6fZ8s68DhHjqXLMMY65q+b9++AQMHmPONMbI/yCHgFOCWf2laY8vfQgjsW+Jp64IopeZPjgk2p01sIQSuc55n9JsCJhi8ht0cC+T12nxHlPB1rQshYJQbuh6JRtra2hbdeuvz//53nz59zj33vC5du2/avHH9uj+3bN7SGe8MKSGEESWksKBw7LhxF1100Zw5cwDg+uv/8cbrr59x1pkFBQVtbR379u3duWP7gerqjvb2gsKCWbNmnX322bNmzVJkxTnNniUY6Pe65tJ3YDkf074gY5wxigBSqnrB3y/4bsl3M4899qnFi8vLywFAkiS/nXctfM6t0TZPbr/rY6480/3inHle1PyPM+55A2ecM55+T/q3QdfxfUq8kTHm/F/xg/0yP2H+Z/5JVVXO+Y4dOw4bNkzC0h133vnIo49NmDgpP79g7Nix99x9z5dffLH2zz/37tu7d9/etX+ufe+9/5599tmlpaWHH374xg0bOedVVbuc30II2b137wcffHDxJRdXVFYAwNixY99+5y01pXLONU0jhNrf7nxA932ywN94/uR5GyG0s7OTc/7MM/8GgJLiYgC4/74HOOeGYQjP0ZwHSsX/ilem6wfckjXOYI9+euacE2aNs+fD3gl2PiQPWiu+KRS363x413pwXJMQImZ3zdo/S0tL+/fr/9abb885bm5ZWfmiRbdu2LDxQE3Nd0t/ePixR6648oqrr736ueee27Rps/js9u3bpx85PTc3d/mvyznnTU1NnZ1xXddVTSPEYIyKt7W0trzzzjtDhw4BgClTpiz7+SfOuapphBDnBDsHPXCUvdvEmhXPNFBKdV1PJlPjDx8vSVJJSamiKG+/9Q7nXDcMz6c817GH1zXllDLxs++v4oTzTbC4OnPMOPdOf3qPcddODZhg56dY0P25B86xjbnYTIZh7N27r0uXrsOGDXv37Xd79ep1zDHH1tU1bNq85cxzzo7m5IRC4V69eg0ZMnTo0KE9evQIhULDhw1/5513OOe6rk+ZOrVr164dHZ1fff3V5MlT29raCSG6plNKCSGGYRiGwTmPx+Nnn3WWMHL33ncf59wwdMMwCCG6rhuE2PuJHdrL807xVOIbOecrfl8ZCYfz8vIURZk0cVIq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";

const CHARACTERS_BEFORE = [
  {
    name: "岡村",
    role: "会議室レイアウター",
    bio: "プロの会議室レイアウターとして、全国各地の会議室をレイアウトしている。今日も理想の会議室を追い求めている。",
    img: OKAMURA_FACE_IMG,
  },
  {
    name: "伊藤(貴) 部長",
    role: "この道の第一人者",
    bio: "今までレイアウトした会議室は1万を超える。今は一線を退き、後進の育成に務める。",
    img: ITO_IMG,
  },
  {
    name: "池谷 社長",
    role: "経営者",
    bio: "北欧生まれ。オフィスよりも家のレイアウトに興味がある。自身の苗字は「いけや」ではなく「いけあ」だと言い張る。",
    img: IKETANI_IMG,
  },
];
// レイアート覚醒イベント後(2年後)の登場人物。岡村がレイアーティストとして名を上げ、
// 伊藤が社長に、池谷が前社長に。新人の浜野未来が加わる。
const CHARACTERS_AFTER = [
  {
    name: "岡村 部長",
    role: "会議室レイアーティスト",
    bio: "会議室レイアートの第一人者。会社の成長に大きく貢献し、異例の若さで部長に昇進。",
    img: OKAMURA_FACE_IMG,
  },
  {
    name: "伊藤(貴) 社長",
    role: "レイアートの発見者",
    bio: "岡村の会議室をヒントに「レイアート」の存在に気づき、新ジャンルとして確立。今年度から社長に就任。",
    img: ITO_IMG,
  },
  {
    name: "浜野 未来",
    role: "新人会議室レイアウター",
    bio: "アメリカの大学で人間工学を学んでいたが、ショールームで岡村の会議室を見て感動し、この会社に就職。荒削りだが、ときどき「レイアーティスト」としての片鱗を見せる。",
    img: HAMANO_IMG,
  },
  {
    name: "池谷 前社長",
    role: "経営者",
    bio: "北欧生まれ。社長を退任したが会社に対する愛は強い。「絶対に壊れない椅子」を作ることが夢。",
    img: IKETANI_IMG,
  },
];

// 伊藤部長(社長)の講評。すでに計算済みの座席効率・集中しやすさ・話しやすさ・動きやすさの指標をもとに、
// レイアウトの状態に応じたひとことを返す。
const METRIC_HIGH_THRESHOLD = 0.8;
function isMetricHigh(v) {
  return v !== null && v !== undefined && v >= METRIC_HIGH_THRESHOLD;
}
// 動きやすさ・話しやすさ・座席効率・作業しやすさ・独創性の5項目すべてが80%以上かどうか。
// 「伝説の会議室」コメント（32パターン中の最後）と、レイアート覚醒イベントの発生条件を兼ねる。
function allMetricsHigh(metrics) {
  if (!metrics) return false;
  return (
    isMetricHigh(metrics.movement) &&
    isMetricHigh(metrics.talkabilityCombined) &&
    isMetricHigh(metrics.seatEfficiency) &&
    isMetricHigh(metrics.workability) &&
    isMetricHigh(metrics.originality)
  );
}
function metricsHighIndex(metrics) {
  const M = metrics.movement, // 動きやすさ
    T = metrics.talkabilityCombined, // 話しやすさ
    S = metrics.seatEfficiency, // 座席効率
    W = metrics.workability, // 作業しやすさ
    O = metrics.originality; // 独創性
  // 5項目それぞれが80%以上かどうかで2^5=32通りに分岐し、組み合わせごとに専用の一言を用意している。
  return ((isMetricHigh(M) ? 1 : 0) << 4) | ((isMetricHigh(T) ? 1 : 0) << 3) | ((isMetricHigh(S) ? 1 : 0) << 2) | ((isMetricHigh(W) ? 1 : 0) << 1) | (isMetricHigh(O) ? 1 : 0);
}
// 部長は基本的に優しいので、5項目すべて80%未満(=見どころが一つもない)のときだけダメ出しし、
// それ以外は必ず褒める。語尾は全パターン「〜だね。」で統一。
const ITO_COMMENTS_32 = [
  /* 00000 */ "最悪の会議室だね。",
  /* 00001 O */ "個性的な会議室だね。",
  /* 00010 W */ "手元の作業に集中しやすそうだね。",
  /* 00011 WO */ "集中していいアイデアを検討できそうだね。",
  /* 00100 S */ "無駄なくスペースを活かせる配置だね。",
  /* 00101 SO */ "各々いいアイデアを出せそうだね。",
  /* 00110 SW */ "効率的に作業できそうだね。",
  /* 00111 SWO */ "面白い作品が書けそうだね。",
  /* 01000 T */ "会話が弾みそうだね。",
  /* 01001 TO */ "会話の中でいいアイデアが出そうだね。",
  /* 01010 TW */ "楽しく作業できそうだね。",
  /* 01011 TWO */ "高校の部活の部室を思い出すね。",
  /* 01100 TS */ "みんなで話せそうだね。",
  /* 01101 TSO */ "縁日みたいだね。",
  /* 01110 TSW */ "止まらない工場のようだね。",
  /* 01111 TSWO */ "ここは原宿、日本の中心だね。",
  /* 10000 M */ "トイレに行きやすそうだね。",
  /* 10001 MO */ "体からアイデアがあふれてきそうだね。",
  /* 10010 MW */ "立ち作業がしやすそうだね。",
  /* 10011 MWO */ "まるで秘密基地だね。",
  /* 10100 MS */ "動きやすいね。",
  /* 10101 MSO */ "美術館に来たみたいだね。",
  /* 10110 MSW */ "空港のラウンジのように快適だね。",
  /* 10111 MSWO */ "最高の研究室だね。",
  /* 11000 MT */ "立ち話しやすそうだね。",
  /* 11001 MTO */ "まるでミュージカルだね。",
  /* 11010 MTW */ "スタートアップのオフィスみたいだね。",
  /* 11011 MTWO */ "テーマパークといっても過言ではないね。",
  /* 11100 MTS */ "飲食店なら大繁盛だね。",
  /* 11101 MTSO */ "パーティーの始まりだね。",
  /* 11110 MTSW */ "非の打ち所がないね。",
  /* 11111 */ "伝説の会議室として語り継がれそうだね。",
];
// 浜野未来のコメント。伊藤と同じ32分岐の講評。海外の大学で人間工学を学んだ新人らしく、
// 語尾は軽めの「です/ます」。伊藤と同じく指標名を直接言わず、短い例えで表現する
// (伊藤の例えと重複しないよう、カフェ→図書館、縁日→屋台、テーマパーク→宇宙旅行等に差し替え)。
const HAMANO_COMMENTS_32 = [
  /* 00000 */ "見損ないました！",
  /* 00001 O */ "アートっぽいです！",
  /* 00010 W */ "図書館みたいです！",
  /* 00011 WO */ "個性派の図書館です！",
  /* 00100 S */ "うまく収まってます！",
  /* 00101 SO */ "パズルみたいです！",
  /* 00110 SW */ "無駄のない工房です！",
  /* 00111 SWO */ "職人の工房っぽいです！",
  /* 01000 T */ "にぎやかです！",
  /* 01001 TO */ "アイデア会議っぽいです！",
  /* 01010 TW */ "和気あいあいです！",
  /* 01011 TWO */ "合宿所みたいです！",
  /* 01100 TS */ "いろんな会話が飛び交いそうです！",
  /* 01101 TSO */ "屋台が並んでそうです！",
  /* 01110 TSW */ "ベルトコンベアみたいです！",
  /* 01111 TSWO */ "シリコンバレーみたいです！",
  /* 10000 M */ "自転車で走れそうです！",
  /* 10001 MO */ "ダンスできそうです！",
  /* 10010 MW */ "キッチンみたいです！",
  /* 10011 MWO */ "アトリエっぽいです！",
  /* 10100 MS */ "フルーツバスケットしたら楽しそうです！",
  /* 10101 MSO */ "ギャラリーみたいです！",
  /* 10110 MSW */ "コワーキングスペースです！",
  /* 10111 MSWO */ "夢のラボです！",
  /* 11000 MT */ "キャンパスっぽいです！",
  /* 11001 MTO */ "フェスみたいです！",
  /* 11010 MTW */ "運動会の準備っぽいです！",
  /* 11011 MTWO */ "宇宙旅行みたいです！",
  /* 11100 MTS */ "オープンキャンパスみたいです！",
  /* 11101 MTSO */ "前夜祭みたいです！",
  /* 11110 MTSW */ "完璧な会議室です！",
  /* 11111 */ "全米が泣きました！",
];

function itoComment(metrics) {
  if (!metrics || metrics.deskCount === 0) {
    return "机がまだ一つもない状態だね。";
  }
  if (metrics.seatCount === 0) {
    return "机はあるが、椅子がまだ一つもない状態だね。";
  }
  return ITO_COMMENTS_32[metricsHighIndex(metrics)];
}
function hamanoComment(metrics) {
  if (!metrics || metrics.deskCount === 0) {
    return "机がまだないです！";
  }
  if (metrics.seatCount === 0) {
    return "椅子がまだないです！";
  }
  return HAMANO_COMMENTS_32[metricsHighIndex(metrics)];
}

function IntroHomeScreen({ onStart, onCharacters, ready, legendaryEventTriggered }) {
  const introText = legendaryEventTriggered
    ? "俺は会議室レイアーティスト岡村。\n今日も理想の会議室を追い求めて、\n会議室をレイアウトし続ける。"
    : "僕は会議室レイアウター岡村。\n今日も理想の会議室を追い求め、\n会議室をレイアウトし続ける。";
  return (
    <div
      style={{
        height: "100vh",
        overflow: "hidden",
        background: "#FFFFFF",
        color: "#1A1A1A",
        display: "flex",
        flexDirection: "column",
        fontFamily: "'Hiragino Mincho ProN', 'Yu Mincho', 'YuMincho', 'MS PMincho', serif",
      }}
    >
      <div style={{ display: "flex", justifyContent: "flex-end", padding: 16, flexShrink: 0 }}>
        <button
          onClick={onCharacters}
          disabled={!ready}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid #D8D8D3",
            background: "#FFFFFF",
            cursor: ready ? "pointer" : "default",
            fontSize: 12,
            color: "#3A3A36",
            opacity: ready ? 1 : 0,
            transition: "opacity 2s ease",
          }}
        >
          <Users size={13} /> 登場人物
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 16px", overflow: "hidden" }}>
        <div style={{ display: "flex", flexWrap: "nowrap", alignItems: "center", justifyContent: "center", gap: 20, maxWidth: 640, width: "100%" }}>
          <div style={{ flex: "1 1 auto", minWidth: 0, textAlign: "left" }}>
            <div style={{ fontSize: "clamp(12px, 3.4vw, 15px)", lineHeight: 1.9, whiteSpace: "pre" }}>{introText}</div>
            <div style={{ fontSize: 11, color: "#B0B0AA", marginTop: 20 }}>※実在の企業や団体、人物とは一切関係はございません。</div>
          </div>
          <img src={OKAMURA_FULL_IMG} alt="岡村" style={{ width: "clamp(90px, 30vw, 180px)", flex: "0 0 auto", display: "block" }} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "center", padding: "0 24px 40px", flexShrink: 0 }}>
        <button
          onClick={onStart}
          disabled={!ready}
          style={{
            padding: "14px 28px",
            borderRadius: 10,
            border: "none",
            background: ACCENT,
            color: "#FFFFFF",
            fontSize: 15,
            fontWeight: 600,
            cursor: ready ? "pointer" : "default",
            opacity: ready ? 1 : 0,
            transition: "opacity 2s ease",
          }}
        >
          会議室をレイアウトする
        </button>
      </div>
    </div>
  );
}

function CharactersScreen({ onBack, legendaryEventTriggered }) {
  const characters = legendaryEventTriggered ? CHARACTERS_AFTER : CHARACTERS_BEFORE;
  return (
    <div style={{ height: "100vh", overflow: "hidden", background: "#FBFBFA", fontFamily: "'Hiragino Mincho ProN', 'Yu Mincho', 'YuMincho', 'MS PMincho', serif", padding: 20, display: "flex", flexDirection: "column" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", width: "100%", height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <button
          onClick={onBack}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #D8D8D3", background: "#FFFFFF", cursor: "pointer", fontSize: 12, color: "#3A3A36", marginBottom: 16, flexShrink: 0, alignSelf: "flex-start" }}
        >
          ← ホームに戻る
        </button>
        <div style={{ fontSize: 18, fontWeight: 600, color: "#1A1A1A", marginBottom: 14, flexShrink: 0 }}>登場人物</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 0, justifyContent: "space-evenly" }}>
          {characters.map((c) => (
            <div key={c.name} style={{ background: "#FFFFFF", border: "1px solid #EDEDEA", borderRadius: 10, padding: 14, display: "flex", gap: 14, alignItems: "center", minHeight: 0 }}>
              {c.img ? (
                <img src={c.img} alt={c.name} style={{ width: 56, height: 56, objectFit: "contain", flexShrink: 0 }} />
              ) : (
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    background: "#EEF3FF",
                    color: CHART_BLUE,
                    fontSize: 20,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {c.name.slice(0, 1)}
                </div>
              )}
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "#1A1A1A", fontSize: 14 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: ACCENT, marginBottom: 4 }}>{c.role}</div>
                <div style={{ fontSize: 12.5, color: "#5A5A54", lineHeight: 1.5 }}>{c.bio}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

class DeskLayoutErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, resetKey: 0 };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: "'Hiragino Mincho ProN', 'Yu Mincho', 'YuMincho', 'MS PMincho', serif", color: "#3A3A36" }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>レイアウトの表示中にエラーが発生しました</div>
          <div style={{ fontSize: 13, color: "#9A9A94", marginBottom: 16 }}>
            机や椅子のデータに不整合が起きた可能性があります。リセットするとレイアウトが空の状態からやり直せます。
          </div>
          <button
            onClick={() => this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }))}
            style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #D8D8D3", background: "#F6F6F4", cursor: "pointer", fontSize: 13 }}
          >
            リセットして最初からやり直す
          </button>
        </div>
      );
    }
    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}
export default function DeskLayoutPuzzleWithBoundary() {
  const [screen, setScreen] = useState("home"); // "home" | "characters" | "layout"
  const [introReady, setIntroReady] = useState(false);
  const [introKey, setIntroKey] = useState(0); // bump this to replay the button fade-in on the home screen
  const [legendaryEventTriggered, setLegendaryEventTriggered] = useState(false);
  const [commentTurn, setCommentTurn] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setIntroReady(true), 3000);
    return () => clearTimeout(t);
  }, [introKey]);
  const replayIntro = () => {
    setIntroReady(false); // set synchronously (batched with the screen change) so there's no flash of the visible button
    setIntroKey((k) => k + 1); // retriggers the effect above to schedule a fresh 3s fade-in
  };
  if (screen === "home") return <IntroHomeScreen ready={introReady} onStart={() => setScreen("layout")} onCharacters={() => setScreen("characters")} legendaryEventTriggered={legendaryEventTriggered} />;
  if (screen === "characters") return <CharactersScreen onBack={() => setScreen("home")} legendaryEventTriggered={legendaryEventTriggered} />;
  return (
    <DeskLayoutErrorBoundary>
      <DeskLayoutPuzzle
        onBackHome={() => setScreen("home")}
        replayIntro={replayIntro}
        legendaryEventTriggered={legendaryEventTriggered}
        setLegendaryEventTriggered={setLegendaryEventTriggered}
        commentTurn={commentTurn}
        setCommentTurn={setCommentTurn}
      />
    </DeskLayoutErrorBoundary>
  );
}
function DeskLayoutPuzzle({ onBackHome, replayIntro, legendaryEventTriggered, setLegendaryEventTriggered, commentTurn, setCommentTurn }) {
  const [roomW, setRoomW] = useState(8);
  const [roomH, setRoomH] = useState(6);
  const [desks, setDesks] = useState([]);
  const [chairs, setChairs] = useState([]); // {id,x,y,rot}
  const [doors, setDoors] = useState([{ id: 1, wall: "bottom", offset: 8 - DOOR_WIDTH }]); // {id,wall,offset} - starts with one door at bottom-right
  const [selection, setSelection] = useState(null);
  const [showComplete, setShowComplete] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [showItoComment, setShowItoComment] = useState(false);
  const [showSpecialEvent, setShowSpecialEvent] = useState(false);
  const [specialEventStep, setSpecialEventStep] = useState(0); // 0: レイアート宣言, 1: 2年後...
  const roomPreviewWrapRef = useRef(null);
  const radarChartWrapRef = useRef(null);
  const [showMetricsPanel, setShowMetricsPanel] = useState(false);
  const [showWs, setShowWs] = useState(false);
  const [showCorridor, setShowCorridor] = useState(false);
  const [draggingChairPos, setDraggingChairPos] = useState(null);
  const [draggingDeskPos, setDraggingDeskPos] = useState(null);
  const [draggingAttachedChairs, setDraggingAttachedChairs] = useState(null); // {[chairId]: {x,y,rot}} — live preview while a desk with chairs attached is being dragged
  const nextDeskId = useRef(1);
  const nextChairId = useRef(1);
  const nextDoorId = useRef(2);
  const svgRef = useRef(null);
  const roomGroupRef = useRef(null); // the <g translate(MARGIN,MARGIN)> — used for screen<->room coordinate conversion so it stays correct under pan/zoom
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 }); // pan/zoom of the room view
  const viewRef = useRef(view);
  viewRef.current = view;
  const bgPointersRef = useRef(new Map()); // pointerId -> {x,y}, active background touches/clicks for pan & pinch-zoom
  const bgGestureRef = useRef(null);
  const dragRef = useRef(null);
  // pointerdown/move/up are registered on `window` as plain DOM listeners, so the specific
  // function instance that's live for a given drag was captured from whatever render was current
  // at pointerdown time. If two gestures happen back-to-back faster than React re-renders (e.g.
  // rapid clicks to rotate a desk several times), that captured closure's `desks`/`chairs`/room
  // size can be one step behind the latest committed state — which showed up as a desk "warping"
  // to the wrong spot, or a chair failing to carry over. Mirroring the latest values into refs
  // (updated synchronously on every render, not via an effect) means the handlers can always read
  // the true current state regardless of which render they were originally attached in.
  const desksRef = useRef(desks);
  desksRef.current = desks;
  const chairsRef = useRef(chairs);
  chairsRef.current = chairs;
  const doorsRef = useRef(doors);
  doorsRef.current = doors;
  const roomWRef = useRef(roomW);
  roomWRef.current = roomW;
  const roomHRef = useRef(roomH);
  roomHRef.current = roomH;

  const metrics = useMemo(() => computeMetrics(desks, chairs, roomW, roomH), [desks, chairs, roomW, roomH]);
  const hasFreeChairSpot = useMemo(() => {
    const pts = attachPointsList(desks).filter(
      (p) => chairFitsInRoom(p.chairCenter, p.frontAngleDeg, roomW, roomH) && chairPointClearOfOtherDesks(p, desks)
    );
    return pts.some((p) => !chairs.some((c) => dist([c.x, c.y], p.chairCenter) < CHAIR_RADIUS * 2 - OVERLAP_EPS));
  }, [desks, chairs, roomW, roomH]);
  const selectedChairId = selection && selection.type === "chair" ? selection.id : null;
  const corridor = useMemo(() => {
    if (desks.length === 0 || chairs.length === 0) return null;
    return computeCorridors(desks, doors, chairs, roomW, roomH, selectedChairId);
  }, [desks, doors, chairs, roomW, roomH, selectedChairId]);
  const corridorByChair = useMemo(() => {
    if (!corridor) return {};
    const map = {};
    corridor.results.forEach((r) => (map[r.chairId] = r));
    return map;
  }, [corridor]);
  // corridor.avgMovability comes from an actual pathfinding/clearance simulation to each exit and
  // is more accurate than the simpler cluster-gap estimate in computeMetrics, so use it as the
  // canonical "動きやすさ" score everywhere (stat card, radar chart, evaluation comment) whenever
  // it's available; only fall back to the simpler estimate if corridor data couldn't be computed.
  const movementScore = corridor ? corridor.avgMovability : metrics ? metrics.movement : 0;
  const metricsForScoring = metrics ? { ...metrics, movement: movementScore } : metrics;

  // called when the user presses 終了する on the evaluation screen. If every metric hit 80%+
  // (the "伝説の会議室" comment) and the レイアート覚醒イベント hasn't happened yet, trigger it
  // instead of leaving normally.
  function handleFinish() {
    if (!legendaryEventTriggered && allMetricsHigh(metricsForScoring)) {
      setLegendaryEventTriggered(true);
      setSpecialEventStep(0);
      setShowSpecialEvent(true);
      return;
    }
    setShowComplete(false);
    if (onBackHome) onBackHome();
  }

  const svgW = MARGIN * 2 + roomW * SCALE;
  const svgH = MARGIN * 2 + roomH * SCALE;
  const toPx = (m) => m * SCALE;

  function screenToRoom(clientX, clientY) {
    const g = roomGroupRef.current;
    const pt = svgRef.current.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const loc = pt.matrixTransform(g.getScreenCTM().inverse());
    return [loc.x / SCALE, loc.y / SCALE];
  }
  function svgPointFromClient(clientX, clientY) {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }
  function clampZoom(s) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s));
  }
  function resetView() {
    setView({ scale: 1, x: 0, y: 0 });
  }

  // background pan (mouse drag, or one remaining finger after a pinch) and pinch-zoom (two touches).
  // Item elements (desks/chairs/doors) call stopPropagation() in their own pointerdown handlers,
  // so this only ever fires for genuine background interaction.
  function onSvgPointerDownBg(e) {
    bgPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = Array.from(bgPointersRef.current.values());
    if (pts.length === 1) {
      bgGestureRef.current = {
        mode: "maybe-pan",
        startClientX: e.clientX,
        startClientY: e.clientY,
        startViewX: viewRef.current.x,
        startViewY: viewRef.current.y,
        moved: false,
      };
    } else if (pts.length === 2) {
      const [a, b] = pts;
      const startMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      bgGestureRef.current = {
        mode: "pinch",
        startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        startMidSvg: svgPointFromClient(startMid.x, startMid.y),
        startView: { ...viewRef.current },
      };
    }
    window.addEventListener("pointermove", onBgPointerMove);
    window.addEventListener("pointerup", onBgPointerUp);
    window.addEventListener("pointercancel", onBgPointerUp);
  }
  function onBgPointerMove(e) {
    if (!bgPointersRef.current.has(e.pointerId)) return;
    bgPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const gesture = bgGestureRef.current;
    if (!gesture) return;
    if (gesture.mode === "pinch") {
      const pts = Array.from(bgPointersRef.current.values());
      if (pts.length < 2) return;
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const midClient = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const midSvg = svgPointFromClient(midClient.x, midClient.y);
      const newScale = clampZoom(gesture.startView.scale * (dist / gesture.startDist));
      const k = newScale / gesture.startView.scale;
      setView({
        scale: newScale,
        x: midSvg.x - k * (gesture.startMidSvg.x - gesture.startView.x),
        y: midSvg.y - k * (gesture.startMidSvg.y - gesture.startView.y),
      });
    } else {
      // maybe-pan / pan / ignored-touch-pan (single pointer)
      const dxPx = e.clientX - gesture.startClientX;
      const dyPx = e.clientY - gesture.startClientY;
      if (gesture.mode === "maybe-pan" && Math.hypot(dxPx, dyPx) < TAP_MOVE_THRESHOLD) return;
      // a single finger should never pan the view on touch devices — panning is two-finger only
      // there, to avoid fighting with tapping/selecting. Mouse/pen still pan with one pointer.
      if (e.pointerType === "touch") {
        gesture.mode = "ignored-touch-pan";
        gesture.moved = true; // real movement happened, so releasing shouldn't be treated as a deselect tap
        return;
      }
      gesture.mode = "pan";
      gesture.moved = true;
      const p0 = svgPointFromClient(gesture.startClientX, gesture.startClientY);
      const p1 = svgPointFromClient(e.clientX, e.clientY);
      setView((v) => ({ ...v, x: gesture.startViewX + (p1.x - p0.x), y: gesture.startViewY + (p1.y - p0.y) }));
    }
  }
  function onBgPointerUp(e) {
    bgPointersRef.current.delete(e.pointerId);
    const gesture = bgGestureRef.current;
    const remaining = Array.from(bgPointersRef.current.values());
    if (remaining.length === 0) {
      window.removeEventListener("pointermove", onBgPointerMove);
      window.removeEventListener("pointerup", onBgPointerUp);
      window.removeEventListener("pointercancel", onBgPointerUp);
      if (gesture && gesture.mode === "maybe-pan" && !gesture.moved) {
        setSelection(null); // genuine tap on empty background — preserve old deselect behavior
      }
      bgGestureRef.current = null;
    } else if (remaining.length === 1) {
      // lifted one finger of a pinch — the remaining single finger shouldn't keep panning
      // (two-finger only on touch), just wait to see if a second finger comes back
      bgGestureRef.current = {
        mode: "ignored-touch-pan",
        startClientX: remaining[0].x,
        startClientY: remaining[0].y,
        startViewX: viewRef.current.x,
        startViewY: viewRef.current.y,
        moved: true,
      };
    }
  }

  function addDesk() {
    const spacing = 2.3; // safely more than the trapezoid's 2m long edge
    const chairSquares = chairObstaclePolys(chairs, desks);
    const isFree = (candidate) =>
      !deskOverlapsAny(candidate, desks) && !deskOutOfRoom(candidate, roomW, roomH) && !deskOverlapsChairSquares(candidate, chairSquares);
    // figure out which part of the room is actually visible right now (accounting for pan/zoom),
    // so a new desk shows up where the person is already looking instead of possibly off-screen
    const visMinX = Math.max(0, (-view.x / view.scale - MARGIN) / SCALE);
    const visMaxX = Math.min(roomW, ((svgW - view.x) / view.scale - MARGIN) / SCALE);
    const visMinY = Math.max(0, (-view.y / view.scale - MARGIN) / SCALE);
    const visMaxY = Math.min(roomH, ((svgH - view.y) / view.scale - MARGIN) / SCALE);
    let placed = null;
    const viewportIsMeaningful = visMaxX - visMinX >= 2 && visMaxY - visMinY >= 2 && (visMinX > 0.05 || visMaxX < roomW - 0.05 || visMinY > 0.05 || visMaxY < roomH - 0.05);
    if (viewportIsMeaningful) {
      for (let ry = visMinY + 1.2; ry < visMaxY - 0.3 && !placed; ry += spacing) {
        for (let rx = visMinX + 1.2; rx < visMaxX - 0.3 && !placed; rx += spacing) {
          const candidate = { x: Math.min(rx, roomW - 1), y: Math.min(ry, roomH - 1), rot: 0 };
          if (isFree(candidate)) placed = candidate;
        }
      }
    }
    if (!placed) {
      for (let ry = 1.5; ry < roomH - 0.3 && !placed; ry += spacing) {
        for (let rx = 1.5; rx < roomW - 0.3 && !placed; rx += spacing) {
          const candidate = { x: Math.min(rx, roomW - 1), y: Math.min(ry, roomH - 1), rot: 0 };
          if (isFree(candidate)) placed = candidate;
        }
      }
    }
    if (!placed) placed = { x: roomW / 2, y: roomH / 2, rot: 0 }; // room is packed — fall back to center
    const id = nextDeskId.current++;
    setDesks((prev) => [...prev, { id, x: placed.x, y: placed.y, rot: 0 }]);
    setSelection({ type: "desk", id });
  }
  function addChair() {
    const center = [roomW / 2, roomH / 2];
    const pts = attachPointsList(desks).filter(
      (p) => chairFitsInRoom(p.chairCenter, p.frontAngleDeg, roomW, roomH) && chairPointClearOfOtherDesks(p, desks) && !chairs.some((c) => dist([c.x, c.y], p.chairCenter) < CHAIR_RADIUS * 2 - OVERLAP_EPS)
    );
    if (pts.length === 0) return; // no free spot on any desk — don't add a deskless chair
    pts.sort((a, b) => dist(a.chairCenter, center) - dist(b.chairCenter, center));
    const x = pts[0].chairCenter[0];
    const y = pts[0].chairCenter[1];
    const rot = pts[0].frontAngleDeg;
    const id = nextChairId.current++;
    setChairs((prev) => [...prev, { id, x, y, rot }]);
    setSelection({ type: "chair", id });
  }
  function addDoor() {
    if (doors.length >= MAX_DOORS) return;
    const slot = findDefaultDoorSlot(doors, roomW, roomH);
    if (!slot) return;
    const id = nextDoorId.current++;
    setDoors((prev) => [...prev, { id, wall: slot.wall, offset: slot.offset }]);
    setSelection({ type: "door", id });
  }
  function deleteSelected() {
    if (!selection) return;
    if (selection.type === "desk") {
      setDesks((prev) => prev.filter((d) => d.id !== selection.id));
    } else if (selection.type === "chair") {
      setChairs((prev) => prev.filter((c) => c.id !== selection.id));
    } else {
      setDoors((prev) => prev.filter((d) => d.id !== selection.id));
    }
    setSelection(null);
  }

  function attachDragListeners() {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  }
  function detachDragListeners() {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
  }
  function onDeskPointerDown(e, id) {
    e.stopPropagation();
    const desk = desksRef.current.find((d) => d.id === id);
    if (!desk) return;
    const [sx, sy] = screenToRoom(e.clientX, e.clientY);
    const ownPts = deskAttachPointsRaw(desk);
    const attachedChairIds = chairsRef.current.filter((c) => ownPts.some((p) => dist(p.chairCenter, [c.x, c.y]) < 0.01)).map((c) => c.id);
    dragRef.current = {
      type: "desk",
      id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
      offsetX: desk.x - sx,
      offsetY: desk.y - sy,
      startX: desk.x,
      startY: desk.y,
      startRot: desk.rot,
      attachedChairIds,
    };
    setSelection({ type: "desk", id });
    attachDragListeners();
  }
  function onChairPointerDown(e, id) {
    e.stopPropagation();
    const chair = chairsRef.current.find((c) => c.id === id);
    if (!chair) return;
    const [sx, sy] = screenToRoom(e.clientX, e.clientY);
    dragRef.current = {
      type: "chair",
      id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
      offsetX: chair.x - sx,
      offsetY: chair.y - sy,
      startX: chair.x,
      startY: chair.y,
      startRot: chair.rot,
    };
    setSelection({ type: "chair", id });
    attachDragListeners();
  }
  function onDoorPointerDown(e, id) {
    e.stopPropagation();
    const door = doorsRef.current.find((d) => d.id === id);
    if (!door) return;
    dragRef.current = {
      type: "door",
      id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
      startWall: door.wall,
      startOffset: door.offset,
    };
    setSelection({ type: "door", id });
    attachDragListeners();
  }
  // shared by pointermove and pointerup: turns a client-coords event into the
  // dragged item's current room-space position
  function updateDragPosFromEvent(drag, e) {
    const [mx, my] = screenToRoom(e.clientX, e.clientY);
    if (drag.type === "desk" || drag.type === "chair") {
      const nx = mx + drag.offsetX;
      const ny = my + drag.offsetY;
      drag.currentPos = [nx, ny];
      return [nx, ny];
    }
    return [mx, my];
  }
  function onPointerMove(e) {
    const drag = dragRef.current;
    if (!drag) return;
    const dxPx = e.clientX - drag.startClientX;
    const dyPx = e.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dxPx, dyPx) < TAP_MOVE_THRESHOLD) return;
    drag.moved = true;
    if (drag.type === "desk") {
      const [nx, ny] = updateDragPosFromEvent(drag, e);
      setDraggingDeskPos([nx, ny]);
      if (drag.attachedChairIds && drag.attachedChairIds.length > 0) {
        const oldDeskState = { id: drag.id, x: drag.startX, y: drag.startY, rot: drag.startRot };
        const newDeskState = { id: drag.id, x: nx, y: ny, rot: drag.startRot };
        const carried = chairsRef.current.filter((c) => drag.attachedChairIds.includes(c.id));
        const moved = reattachChairs(oldDeskState, newDeskState, carried);
        const map = {};
        moved.forEach((c) => (map[c.id] = { x: c.x, y: c.y, rot: c.rot }));
        setDraggingAttachedChairs(map);
      }
    } else if (drag.type === "chair") {
      const [nx, ny] = updateDragPosFromEvent(drag, e);
      setDraggingChairPos([nx, ny]);
    } else if (drag.type === "door") {
      const [mx, my] = updateDragPosFromEvent(drag, e);
      const placement = nearestWallPlacement([mx, my], roomWRef.current, roomHRef.current);
      if (placement) {
        setDoors((prev) => prev.map((d) => (d.id === drag.id ? { ...d, wall: placement.wall, offset: placement.offset } : d)));
      }
    }
  }
  function onPointerUp(e) {
    detachDragListeners();
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    // always resolve the final position from the up-event itself (rather than trusting only
    // whatever pointermove happened to fire last) so a quick drag that the browser only
    // delivered a couple of move events for still lands where the pointer actually was
    if (drag.moved && e && (drag.type === "desk" || drag.type === "chair")) {
      updateDragPosFromEvent(drag, e);
    }

    if (drag.type === "desk") {
      if (!drag.moved) {
        const oldDesk = desksRef.current.find((d) => d.id === drag.id);
        if (oldDesk) {
          const others = desksRef.current.filter((d) => d.id !== drag.id);
          const ownPts = deskAttachPointsRaw(oldDesk);
          const ownChairIds = new Set(chairsRef.current.filter((c) => ownPts.some((p) => dist(p.chairCenter, [c.x, c.y]) < 0.01)).map((c) => c.id));
          const otherChairSquares = chairsRef.current.filter((c) => !ownChairIds.has(c.id)).map((c) => rectVerts(c.x, c.y, chairDeskAngleRad(c.x, c.y, desksRef.current), 1, 1));
          const rotated = { ...oldDesk, rot: (oldDesk.rot + ROTATE_STEP) % 360 };
          const blocked =
            deskOverlapsAny(rotated, others) ||
            deskOutOfRoom(rotated, roomWRef.current, roomHRef.current) ||
            deskOverlapsChairSquares(rotated, otherChairSquares) ||
            !attachedChairsOk(oldDesk, rotated, chairsRef.current, desksRef.current, roomWRef.current, roomHRef.current);
          if (!blocked) {
            setDesks((prev) => prev.map((d) => (d.id === drag.id ? rotated : d)));
            setChairs((prev) => reattachChairs(oldDesk, rotated, prev));
          }
        }
      } else {
        const oldDesk = desksRef.current.find((d) => d.id === drag.id);
        if (oldDesk) {
          const rawPos = drag.currentPos || [oldDesk.x, oldDesk.y];
          const others = desksRef.current.filter((d) => d.id !== drag.id);
          const ownPts = deskAttachPointsRaw(oldDesk);
          const ownChairIds = new Set(chairsRef.current.filter((c) => ownPts.some((p) => dist(p.chairCenter, [c.x, c.y]) < 0.01)).map((c) => c.id));
          const otherChairSquares = chairsRef.current.filter((c) => !ownChairIds.has(c.id)).map((c) => rectVerts(c.x, c.y, chairDeskAngleRad(c.x, c.y, desksRef.current), 1, 1));
          function collides(pos) {
            const testDesk = { ...oldDesk, x: pos[0], y: pos[1] };
            return (
              deskOverlapsAny(testDesk, others) ||
              deskOutOfRoom(testDesk, roomWRef.current, roomHRef.current) ||
              deskOverlapsChairSquares(testDesk, otherChairSquares) ||
              !attachedChairsOk(oldDesk, testDesk, chairsRef.current, desksRef.current, roomWRef.current, roomHRef.current)
            );
          }
          const startPos = [drag.startX, drag.startY];
          let slidPos = rawPos;
          if (collides(rawPos)) {
            if (collides(startPos)) {
              slidPos = startPos;
            } else {
              // binary search along the drag path for the last valid position — stop right at contact
              let lo = 0,
                hi = 1;
              for (let i = 0; i < 20; i++) {
                const t = (lo + hi) / 2;
                const p = [startPos[0] + (rawPos[0] - startPos[0]) * t, startPos[1] + (rawPos[1] - startPos[1]) * t];
                if (collides(p)) hi = t;
                else lo = t;
              }
              slidPos = [startPos[0] + (rawPos[0] - startPos[0]) * lo, startPos[1] + (rawPos[1] - startPos[1]) * lo];
            }
          }
          const rawDesk = { ...oldDesk, x: slidPos[0], y: slidPos[1] };
          // keep the on-screen snap "feel" consistent regardless of zoom: a fixed real-world
          // tolerance (meters) becomes a tiny, hard-to-hit target once zoomed out, so scale it up
          // as the view shrinks (never smaller than the 0.4m default, only ever larger)
          const zoomAdaptiveSnapTol = CORNER_SNAP / Math.min(1, viewRef.current.scale);
          const corner = tryCornerSnap(rawDesk, others, zoomAdaptiveSnapTol);
          const snap = corner || tryEdgeSnap(rawDesk, others, zoomAdaptiveSnapTol);
          let candidate = snap ? { ...rawDesk, x: rawDesk.x + snap.dx, y: rawDesk.y + snap.dy } : rawDesk;
          if (collides([candidate.x, candidate.y])) candidate = collides([rawDesk.x, rawDesk.y]) ? { ...rawDesk, x: drag.startX, y: drag.startY } : rawDesk;
          if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) candidate = { ...oldDesk };
          setDesks((prev) => prev.map((d) => (d.id === drag.id ? candidate : d)));
          setChairs((prev) => reattachChairs(oldDesk, candidate, prev));
        }
        setDraggingDeskPos(null);
        setDraggingAttachedChairs(null);
      }
    } else if (drag.type === "chair") {
      if (!drag.moved) {
        // tap does nothing — a chair's facing is fixed to its desk edge, not user-rotatable
      } else {
        const rawPos = drag.currentPos || [drag.startX, drag.startY];
        const others = chairsRef.current.filter((c) => c.id !== drag.id);
        const pts = attachPointsList(desksRef.current).filter(
          (p) =>
            chairFitsInRoom(p.chairCenter, p.frontAngleDeg, roomWRef.current, roomHRef.current) &&
            chairPointClearOfOtherDesks(p, desksRef.current) &&
            !others.some((o) => dist([o.x, o.y], p.chairCenter) < CHAIR_RADIUS * 2 - OVERLAP_EPS)
        );
        let finalPos = [drag.startX, drag.startY],
          finalRot = drag.startRot;
        if (pts.length > 0) {
          pts.sort((a, b) => dist(a.chairCenter, rawPos) - dist(b.chairCenter, rawPos));
          finalPos = pts[0].chairCenter;
          finalRot = pts[0].frontAngleDeg;
        }
        if (!Number.isFinite(finalPos[0]) || !Number.isFinite(finalPos[1])) {
          finalPos = [drag.startX, drag.startY];
          finalRot = drag.startRot;
        }
        setChairs((prev) => prev.map((c) => (c.id === drag.id ? { ...c, x: finalPos[0], y: finalPos[1], rot: finalRot } : c)));
      }
      setDraggingChairPos(null);
    } else if (drag.type === "door") {
      if (drag.moved) {
        if (e) {
          const [mx, my] = updateDragPosFromEvent(drag, e);
          const placement = nearestWallPlacement([mx, my], roomWRef.current, roomHRef.current);
          if (placement) {
            setDoors((prev) => prev.map((d) => (d.id === drag.id ? { ...d, wall: placement.wall, offset: placement.offset } : d)));
          }
        }
        setDoors((prev) => {
          const idx = prev.findIndex((d) => d.id === drag.id);
          if (idx === -1) return prev;
          const others = prev.filter((_, i) => i !== idx);
          const current = prev[idx];
          if (others.some((o) => doorsOverlap(current, o, roomWRef.current, roomHRef.current))) {
            const copy = [...prev];
            copy[idx] = { ...current, wall: drag.startWall, offset: drag.startOffset };
            return copy;
          }
          return prev;
        });
      }
    }
  }

  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === "INPUT") return;
      if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, desks, chairs, doors]);

  // mouse-wheel zoom, centered on the cursor. Attached as a real (non-passive) DOM listener —
  // React's onWheel is passive by default, which silently ignores preventDefault() and lets the
  // page scroll instead of zooming the room.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e) {
      e.preventDefault();
      const p = svgPointFromClient(e.clientX, e.clientY);
      setView((v) => {
        const factor = Math.exp(-e.deltaY * 0.0015);
        const newScale = clampZoom(v.scale * factor);
        const k = newScale / v.scale;
        return { scale: newScale, x: p.x - k * (p.x - v.x), y: p.y - k * (p.y - v.y) };
      });
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!showComplete) {
      setShowItoComment(false);
      return;
    }
    // 覚醒イベント後は伊藤と浜野で交互にコメントする。順番はここでカウントする。
    if (legendaryEventTriggered) setCommentTurn((t) => t + 1);
    const t = setTimeout(() => setShowItoComment(true), radarTotalDuration(5));
    return () => clearTimeout(t);
  }, [showComplete]);

  // safety net: a chair should always sit exactly on one of its desk's attach points. If some
  // interaction ever leaves one slightly off (e.g. a desk update that didn't carry it along), it
  // would otherwise become a stray obstacle sitting in the room forever, silently blocking future
  // moves/rotations of every desk it happens to be in the way of. Whenever the desks change, check
  // that every chair still lines up with a real attach point and re-home any that don't.
  useEffect(() => {
    setChairs((prevChairs) => {
      if (prevChairs.length === 0) return prevChairs;
      const rawPts = [];
      desks.forEach((d) => deskAttachPointsRaw(d).forEach((p) => rawPts.push(p)));
      let changed = false;
      const next = prevChairs.map((c) => {
        const stillAttached = rawPts.some((p) => dist(p.chairCenter, [c.x, c.y]) < 0.02);
        if (stillAttached) return c;
        const candidates = attachPointsList(desks).filter(
          (p) =>
            chairFitsInRoom(p.chairCenter, p.frontAngleDeg, roomW, roomH) &&
            chairPointClearOfOtherDesks(p, desks) &&
            !prevChairs.some((o) => o.id !== c.id && dist([o.x, o.y], p.chairCenter) < CHAIR_RADIUS * 2 - OVERLAP_EPS)
        );
        if (candidates.length === 0) return c; // nowhere valid to put it back — leave it rather than guess
        candidates.sort((a, b) => dist(a.chairCenter, [c.x, c.y]) - dist(b.chairCenter, [c.x, c.y]));
        changed = true;
        return { ...c, x: candidates[0].chairCenter[0], y: candidates[0].chairCenter[1], rot: candidates[0].frontAngleDeg };
      });
      return changed ? next : prevChairs;
    });
  }, [desks, roomW, roomH]);

  return (
    <div style={{ background: "#FBFBFA", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "'Hiragino Mincho ProN', 'Yu Mincho', 'YuMincho', 'MS PMincho', serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px 8px", flexShrink: 0, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {onBackHome && (
            <button onClick={onBackHome} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #D8D8D3", background: "#FFFFFF", cursor: "pointer", fontSize: 12, color: "#3A3A36" }}>
              ← ホーム
            </button>
          )}
        </div>
        <button
          onClick={() => setShowMetricsPanel(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: "1px solid #D8D8D3", background: "#FFFFFF", cursor: "pointer", fontSize: 12.5, color: "#3A3A36" }}
        >
          <Sparkles size={13} /> 現状評価
        </button>
      </div>

      {showMetricsPanel && (
        <div
          onClick={() => setShowMetricsPanel(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(26,26,26,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 20 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#FFFFFF", borderRadius: 12, padding: 20, maxWidth: 640, width: "100%", maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "#1A1A1A" }}>評価指標</div>
              <button onClick={() => setShowMetricsPanel(false)} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #D8D8D3", background: "#F6F6F4", cursor: "pointer", fontSize: 12 }}>
                閉じる
              </button>
            </div>
            {!metrics ? (
              <div style={{ color: "#B4B4AE", fontSize: 13, padding: 20, border: "1px dashed #E0E0DC", borderRadius: 8 }}>「机を追加」でスタート</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <StatCard
                  icon={Move}
                  label="動きやすさ"
                  value={!chairs.length ? "—" : pct(movementScore)}
                  sub={!chairs.length ? "椅子がありません" : corridor ? "各席〜出口の最も狭い所(1m換算)の平均" : "通路1m確保の達成度(概算)"}
                />
                <StatCard
                  icon={MessageCircle}
                  label="話しやすさ"
                  value={metrics.talkabilityCombined === null ? "—" : pct(metrics.talkabilityCombined)}
                  sub={
                    !chairs.length
                      ? "椅子がありません"
                      : metrics.talkabilityCombined === null
                      ? "島に椅子が2脚以上必要です"
                      : metrics.islands.length > 1
                      ? "視線が集まる点への収束度: " + metrics.islands.map((isl, i) => (isl.gazeConvergence === null ? `島${i + 1} —` : `島${i + 1} ${Math.round(isl.gazeConvergence * 100)}%`)).join(" / ")
                      : "視線が集まる点への収束度"
                  }
                />
                <StatCard icon={Users} label="座席効率" value={pct(metrics.seatEfficiency)} sub={`${metrics.seatCount}席 / ${roomW}×${roomH}m² (4m²/席で100%)`} />
                <StatCard icon={Sparkles} label="作業しやすさ" value={chairs.length ? pct(metrics.workability) : "—"} sub={chairs.length ? "1人分の作業スペースのうち実質使える広さの割合(被った分は人数で分け合う)" : "椅子がありません"} />
                <StatCard
                  icon={Sparkles}
                  label="独創性"
                  value={pct(metrics.originality)}
                  sub={`輪郭${metrics.outlineEdgeCount}辺 (机${metrics.deskCount}台) → (${metrics.outlineEdgeCount}-4)/44`}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {showComplete && (
        <div style={{ position: "fixed", inset: 0, background: "#FBFBFA", zIndex: 60, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px", flexShrink: 0, gap: 8 }}>
            <button
              onClick={() => setShowComplete(false)}
              style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid #D8D8D3", background: "#FFFFFF", cursor: "pointer", fontSize: 12, color: "#3A3A36", flexShrink: 0 }}
            >
              戻る
            </button>
            {roomName.trim() && (
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  fontSize: 15,
                  fontWeight: 700,
                  color: "#1A1A1A",
                  textAlign: "center",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "50%",
                  pointerEvents: "none",
                }}
              >
                {roomName}
              </div>
            )}
            <button
              onClick={handleFinish}
              style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: ACCENT, color: "#FFFFFF", cursor: "pointer", fontSize: 12.5, fontWeight: 600, flexShrink: 0 }}
            >
              終了
            </button>
          </div>
          <div ref={roomPreviewWrapRef} style={{ flex: 5, minHeight: 0, padding: "0 16px 2px", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <RoomPreview desks={desks} chairs={chairs} doors={doors} roomW={roomW} roomH={roomH} />
          </div>
          <div ref={radarChartWrapRef} style={{ flex: 4, minHeight: 0, padding: "0 16px", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            <RadarChart
              size={600}
              axes={[
                { label: "動きやすさ", value: movementScore },
                { label: "話しやすさ", value: metrics && metrics.talkabilityCombined !== null ? metrics.talkabilityCombined : 0, valueDirectlyBelowLabel: true },
                { label: "座席効率", value: metrics ? metrics.seatEfficiency : 0, valueAbove: true },
                { label: "作業しやすさ", value: metrics ? metrics.workability : 0, valueAbove: true },
                { label: "独創性", value: metrics ? metrics.originality : 0, valueDirectlyBelowLabel: true },
              ]}
              onComplete={() => setShowItoComment(true)}
            />
          </div>
          <div style={{ flex: 1, minHeight: 0, padding: "0 16px 4px", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
            {showItoComment && (() => {
              // 覚醒イベント後は伊藤と浜野が2回に1回ずつ交互にコメントする。イベント前は常に伊藤。
              const isHamanoTurn = legendaryEventTriggered && commentTurn % 2 === 0;
              const speakerName = isHamanoTurn ? "浜野 未来" : legendaryEventTriggered ? "伊藤(貴) 社長" : "伊藤(貴) 部長";
              const commentText = isHamanoTurn ? hamanoComment(metricsForScoring) : itoComment(metricsForScoring);
              return (
                <div style={{ display: "flex", alignItems: "flex-end", gap: 10, width: "100%", maxWidth: 480 }}>
                  {isHamanoTurn ? (
                    <img src={HAMANO_IMG} alt={speakerName} style={{ width: 44, height: 44, objectFit: "contain", flexShrink: 0 }} />
                  ) : (
                    <img src={ITO_IMG} alt={speakerName} style={{ width: 44, height: 44, objectFit: "contain", flexShrink: 0 }} />
                  )}
                  <div style={{ position: "relative", background: "#F0F0EE", borderRadius: 16, padding: "10px 14px", flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        position: "absolute",
                        left: -8,
                        bottom: 14,
                        width: 0,
                        height: 0,
                        borderTop: "8px solid transparent",
                        borderBottom: "8px solid transparent",
                        borderRight: "10px solid #F0F0EE",
                      }}
                    />
                    <div style={{ fontSize: 13.5, color: "#1A1A1A", lineHeight: 1.5 }}>{commentText}</div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {showSpecialEvent && (
        <div style={{ position: "fixed", inset: 0, background: "#FFFFFF", zIndex: 80, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
          {specialEventStep === 0 ? (
            <>
              <img src={ITO_SURPRISED_IMG} alt="伊藤(貴) 部長" style={{ width: 170, marginBottom: 28, display: "block" }} />
              <div style={{ color: "#1A1A1A", fontSize: 18, textAlign: "center", maxWidth: 420, lineHeight: 1.9, marginBottom: 36 }}>
                これは・・・レイアウトを超えて、レイアート(Lay-art)だ！
              </div>
              <button
                onClick={() => setSpecialEventStep(1)}
                style={{ padding: "10px 28px", borderRadius: 10, border: "none", background: ACCENT, color: "#FFFFFF", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
              >
                次へ
              </button>
            </>
          ) : (
            <>
              <div style={{ color: "#1A1A1A", fontSize: 22, letterSpacing: 4, textAlign: "center", marginBottom: 40 }}>2年後・・・</div>
              <button
                onClick={() => {
                  setShowSpecialEvent(false);
                  setSpecialEventStep(0);
                  setShowComplete(false);
                  if (replayIntro) replayIntro();
                  if (onBackHome) onBackHome();
                }}
                style={{ padding: "10px 28px", borderRadius: 10, border: "none", background: ACCENT, color: "#FFFFFF", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
              >
                閉じる
              </button>
            </>
          )}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "0 16px" }}>
        <div style={{ display: "flex", gap: 4, marginBottom: 6, alignItems: "center", flexWrap: "nowrap", overflowX: "auto", flexShrink: 0 }}>
              <button onClick={addDesk} style={{ ...btnStyle(true), fontSize: 11.5, padding: "5px 8px", whiteSpace: "nowrap", flexShrink: 0 }}>
                <Plus size={12} /> 机追加
              </button>
              <button onClick={addChair} style={{ ...btnStyle(false, !hasFreeChairSpot), fontSize: 11.5, padding: "5px 8px", whiteSpace: "nowrap", flexShrink: 0 }} disabled={!hasFreeChairSpot}>
                <Circle size={10} /> 椅子追加
              </button>
              <button onClick={addDoor} style={{ ...btnStyle(false, doors.length >= MAX_DOORS), fontSize: 11.5, padding: "5px 8px", whiteSpace: "nowrap", flexShrink: 0 }} disabled={doors.length >= MAX_DOORS}>
                <DoorOpen size={12} /> 出入口追加
              </button>
              <button onClick={deleteSelected} style={{ ...btnStyle(false, !selection), fontSize: 11.5, padding: "5px 8px", whiteSpace: "nowrap", flexShrink: 0, marginLeft: 12 }} disabled={!selection}>
                <Trash2 size={12} /> 削除
              </button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center", flexWrap: "wrap", flexShrink: 0 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#9A9A94" }}>
                <input type="checkbox" checked={showWs} onChange={(e) => setShowWs(e.target.checked)} style={{ accentColor: "#1A1A1A" }} />
                作業スペース表示
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#9A9A94" }}>
                <input type="checkbox" checked={showCorridor} onChange={(e) => setShowCorridor(e.target.checked)} style={{ accentColor: "#1A1A1A" }} />
                動きやすさを表示
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center", flexWrap: "nowrap", overflowX: "auto", flexShrink: 0 }}>
              <button onClick={resetView} style={{ ...btnStyle(false, view.scale === 1 && view.x === 0 && view.y === 0), flexShrink: 0, whiteSpace: "nowrap" }} title="表示位置とズームをリセット">
                <RotateCcw size={13} /> {Math.round(view.scale * 100)}%
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#9A9A94", flexShrink: 0, whiteSpace: "nowrap" }}>
                <Ruler size={13} />
                幅
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <button
                    onClick={() => {
                      const { minW } = minRoomSizeFor(desks, chairs);
                      setRoomW((w) => Math.max(ceilHalf(minW), snapHalf(w - 0.5)));
                    }}
                    style={stepperBtnStyle}
                    aria-label="幅を0.5m減らす"
                  >
                    <Minus size={12} />
                  </button>
                  <span style={{ minWidth: 30, textAlign: "center", color: "#1A1A1A" }}>{roomW.toFixed(1)}</span>
                  <button
                    onClick={() => setRoomW((w) => Math.min(20, snapHalf(w + 0.5)))}
                    style={stepperBtnStyle}
                    aria-label="幅を0.5m増やす"
                  >
                    <Plus size={12} />
                  </button>
                </span>
                m × 奥行
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <button
                    onClick={() => {
                      const { minH } = minRoomSizeFor(desks, chairs);
                      setRoomH((h) => Math.max(ceilHalf(minH), snapHalf(h - 0.5)));
                    }}
                    style={stepperBtnStyle}
                    aria-label="奥行を0.5m減らす"
                  >
                    <Minus size={12} />
                  </button>
                  <span style={{ minWidth: 30, textAlign: "center", color: "#1A1A1A" }}>{roomH.toFixed(1)}</span>
                  <button
                    onClick={() => setRoomH((h) => Math.min(20, snapHalf(h + 0.5)))}
                    style={stepperBtnStyle}
                    aria-label="奥行を0.5m増やす"
                  >
                    <Plus size={12} />
                  </button>
                </span>
                m
              </div>
            </div>

            <svg
              ref={svgRef}
              viewBox={`0 0 ${svgW} ${svgH}`}
              width="100%"
              height="100%"
              preserveAspectRatio="xMidYMid meet"
              style={{ background: "#FFFFFF", borderRadius: 10, border: "1px solid #EDEDEA", touchAction: "none", cursor: "grab", flex: 1, minHeight: 0, display: "block" }}
              onPointerDown={onSvgPointerDownBg}
            >
              <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
                <rect x={MARGIN} y={MARGIN} width={toPx(roomW)} height={toPx(roomH)} fill="#FFFFFF" stroke="#8A8A84" strokeWidth={1.8} />
                <g ref={roomGroupRef} transform={`translate(${MARGIN},${MARGIN})`}>
                  {desks.map((desk) => {
                  const isDragging = dragRef.current && dragRef.current.type === "desk" && dragRef.current.id === desk.id && draggingDeskPos;
                  const deskForRender = isDragging ? { ...desk, x: draggingDeskPos[0], y: draggingDeskPos[1] } : desk;
                  const poly = deskPolygon(deskForRender).map(([x, y]) => [toPx(x), toPx(y)]);
                  const isSel = selection && selection.type === "desk" && selection.id === desk.id;
                  return (
                    <path
                      key={"d" + desk.id}
                      d={roundedPolyPath(poly, 6)}
                      fill={isSel ? "#EEF3FF" : "#ECECE8"}
                      stroke={isSel ? CHART_BLUE : "#8A8A84"}
                      strokeWidth={isSel ? 2 : 1.6}
                      onPointerDown={(e) => onDeskPointerDown(e, desk.id)}
                      style={{ cursor: "grab" }}
                    />
                  );
                })}

                {showWs &&
                  chairs.map((c) => {
                    const isDragging = dragRef.current && dragRef.current.type === "chair" && dragRef.current.id === c.id && draggingChairPos;
                    const attachedPreview = draggingAttachedChairs && draggingAttachedChairs[c.id];
                    const pos = isDragging ? draggingChairPos : attachedPreview ? [attachedPreview.x, attachedPreview.y] : [c.x, c.y];
                    const rot = attachedPreview ? attachedPreview.rot : c.rot;
                    const wsPts = seatWorkspacePoly(pos[0], pos[1], rot, desks)
                      .map(([x, y]) => [toPx(x), toPx(y)].join(","))
                      .join(" ");
                    return <polygon key={"ws" + c.id} points={wsPts} fill="rgba(47,111,237,0.06)" stroke="rgba(47,111,237,0.18)" strokeWidth={0.5} />;
                  })}

                {showCorridor &&
                  chairs.map((c) => {
                    const angle = chairDeskAngleRad(c.x, c.y, desks);
                    const pts = rectVerts(c.x, c.y, angle, 1, 1)
                      .map(([x, y]) => [toPx(x), toPx(y)].join(","))
                      .join(" ");
                    return <polygon key={"cobs" + c.id} points={pts} fill="rgba(224,90,90,0.05)" stroke="rgba(224,90,90,0.35)" strokeWidth={1} strokeDasharray="3,2" />;
                  })}

                {showCorridor &&
                  corridor &&
                  corridor.results.map((res) => {
                    if (!res.reachable || res.path.length < 2) return null;
                    const pts = res.path.map(([x, y]) => [toPx(x), toPx(y)].join(",")).join(" ");
                    return <polyline key={"path" + res.chairId} points={pts} fill="none" stroke="#2F6FED" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.75} />;
                  })}

                {showCorridor &&
                  corridor &&
                  corridor.results.map((res) => {
                    if (!res.reachable || !res.arrowNear || !res.arrowFar) return null;
                    const midX = (res.arrowNear[0] + res.arrowFar[0]) / 2;
                    const midY = (res.arrowNear[1] + res.arrowFar[1]) / 2;
                    const color = "#E0A23F";
                    const x1 = toPx(res.arrowNear[0]),
                      y1 = toPx(res.arrowNear[1]);
                    const x2 = toPx(res.arrowFar[0]),
                      y2 = toPx(res.arrowFar[1]);
                    return (
                      <g key={"bn" + res.chairId}>
                        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={1.5} />
                        <circle cx={x1} cy={y1} r={4} fill={color} stroke="#FFFFFF" strokeWidth={1.2} />
                        <circle cx={x2} cy={y2} r={4} fill={color} stroke="#FFFFFF" strokeWidth={1.2} />
                        <text x={toPx(midX) + 6} y={toPx(midY) - 4} fontSize={9} fill={color}>
                          {res.width.toFixed(2)}m
                        </text>
                      </g>
                    );
                  })}

                {chairs.map((c) => {
                  const isDragging = dragRef.current && dragRef.current.type === "chair" && dragRef.current.id === c.id && draggingChairPos;
                  const attachedPreview = draggingAttachedChairs && draggingAttachedChairs[c.id];
                  const pos = isDragging ? draggingChairPos : attachedPreview ? [attachedPreview.x, attachedPreview.y] : [c.x, c.y];
                  const rot = attachedPreview ? attachedPreview.rot : c.rot;
                  const isSel = selection && selection.type === "chair" && selection.id === c.id;
                  const R = toPx(CHAIR_RADIUS);
                  const cxPx = toPx(pos[0]),
                    cyPx = toPx(pos[1]);
                  const cr = showCorridor && corridor ? corridorByChair[c.id] : null;
                  const ringColor = cr ? (!cr.reachable ? "#E05A5A" : null) : null;
                  return (
                    <g key={"c" + c.id} onPointerDown={(e) => onChairPointerDown(e, c.id)} style={{ cursor: "grab" }}>
                      {ringColor && <circle cx={cxPx} cy={cyPx} r={R + 4} fill="none" stroke={ringColor} strokeWidth={2} />}
                      <circle cx={cxPx} cy={cyPx} r={R} fill={isSel ? "#EEF3FF" : "#FFFFFF"} stroke={isSel ? CHART_BLUE : "#6B6B66"} strokeWidth={isSel ? 2 : 1.6} />
                      <polygon points={triangleStr(cxPx, cyPx, rot, R)} fill={isSel ? CHART_BLUE : "#6B6B66"} />
                    </g>
                  );
                })}

                {doors.map((door) => {
                  const g = doorGeom(door, roomW, roomH);
                  const p1 = [toPx(g.p1[0]), toPx(g.p1[1])];
                  const p2 = [toPx(g.p2[0]), toPx(g.p2[1])];
                  const tick = toPx(0.15);
                  const nrm = [g.normal[0] * tick, g.normal[1] * tick];
                  const t1 = [p1[0] + nrm[0], p1[1] + nrm[1]];
                  const t2 = [p2[0] + nrm[0], p2[1] + nrm[1]];
                  const isSel = selection && selection.type === "door" && selection.id === door.id;
                  const color = isSel ? CHART_BLUE : "#9A9A94";
                  return (
                    <g key={"door" + door.id} onPointerDown={(e) => onDoorPointerDown(e, door.id)} style={{ cursor: "grab" }}>
                      <line x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke="#FFFFFF" strokeWidth={5} />
                      <line x1={p1[0]} y1={p1[1]} x2={p2[0]} y2={p2[1]} stroke="transparent" strokeWidth={16} />
                      <line x1={p1[0]} y1={p1[1]} x2={t1[0]} y2={t1[1]} stroke={color} strokeWidth={1.5} />
                      <line x1={p2[0]} y1={p2[1]} x2={t2[0]} y2={t2[1]} stroke={color} strokeWidth={1.5} />
                    </g>
                  );
                })}
                </g>
              </g>
            </svg>
          </div>

      <div style={{ flexShrink: 0, padding: "10px 16px", display: "flex", justifyContent: "center", alignItems: "center", gap: 10 }}>
        <input
          type="text"
          value={roomName}
          onChange={(e) => setRoomName(e.target.value)}
          placeholder="会議室名(任意)"
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #D8D8D3", background: "#FFFFFF", fontSize: 13.5, color: "#1A1A1A", width: 200 }}
        />
        <button
          onClick={() => {
            setShowItoComment(false);
            setShowComplete(true);
          }}
          style={{ padding: "10px 28px", borderRadius: 10, border: "none", background: ACCENT, color: "#FFFFFF", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
        >
          完成
        </button>
      </div>
    </div>
  );
}
