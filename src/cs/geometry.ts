// Pure measurement geometry on image pixel coordinates + calibration (unit-tested).
export type P2 = [number, number];
export interface Scale {
  sx: number; // mm per pixel horizontally (or 1 for px)
  sy: number;
}

const phys = (p: P2, s: Scale): P2 => [p[0] * s.sx, p[1] * s.sy];

export function length(a: P2, b: P2, s: Scale) {
  const [ax, ay] = phys(a, s);
  const [bx, by] = phys(b, s);
  return Math.hypot(bx - ax, by - ay);
}

/** Three-point angle at vertex b, in degrees [0..180]. */
export function angle3(a: P2, b: P2, c: P2, s: Scale) {
  const [ax, ay] = phys(a, s);
  const [bx, by] = phys(b, s);
  const [cx, cy] = phys(c, s);
  const v1 = [ax - bx, ay - by];
  const v2 = [cx - bx, cy - by];
  const n = Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]);
  if (!n) return NaN;
  const cos = Math.min(1, Math.max(-1, (v1[0] * v2[0] + v1[1] * v2[1]) / n));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Angle between two freely placed lines (they need not intersect).
 * Returns inner (acute, 0–90°) and supplementary (180° − inner) angle.
 */
export function angleBetweenLines(p1: P2, p2: P2, p3: P2, p4: P2, s: Scale) {
  const [a, b, c, d] = [p1, p2, p3, p4].map((p) => phys(p, s));
  const u = [b[0] - a[0], b[1] - a[1]];
  const v = [d[0] - c[0], d[1] - c[1]];
  const n = Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]);
  if (!n) return { inner: NaN, supplementary: NaN };
  const cos = Math.abs((u[0] * v[0] + u[1] * v[1]) / n);
  const inner = (Math.acos(Math.min(1, cos)) * 180) / Math.PI;
  return { inner, supplementary: 180 - inner };
}

export function circleDiameter(center: P2, edge: P2, s: Scale) {
  return 2 * length(center, edge, s);
}
