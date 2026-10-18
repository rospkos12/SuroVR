// Procedural geometry as plain arrays: a unit cube, a floor grid, a ring.

// Unit cube centred on the origin (side 1), 4 vertices per face for flat normals.
export function cube() {
  const faces = [
    // normal,      tangent u,   tangent v
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  ];
  const positions = [], normals = [], indices = [];
  faces.forEach(([n, u, v], f) => {
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (let i = 0; i < 3; i++) positions.push(0.5 * (n[i] + su * u[i] + sv * v[i]));
      normals.push(...n);
    }
    const b = f * 4;
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return { positions, normals, indices };
}

// Square grid of lines on the y = 0 plane, `half` metres in each direction.
// Lines are split into `step`-long segments: long lines that pass behind the
// camera get clipped badly by some GPUs, short segments avoid that.
export function grid(half = 10, step = 1) {
  const positions = [];
  for (let i = -half; i <= half; i += step) {
    for (let j = -half; j < half; j += step) {
      positions.push(i, 0, j, i, 0, j + step); // segment parallel to Z
      positions.push(j, 0, i, j + step, 0, i); // segment parallel to X
    }
  }
  return { positions, mode: WebGLRenderingContext.LINES };
}

// Flat ring on the y = 0 plane (used as the AR reticle).
export function ring(inner = 0.08, outer = 0.1, segments = 32) {
  const positions = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    positions.push(c * outer, 0, s * outer, c * inner, 0, s * inner);
  }
  return { positions, mode: WebGLRenderingContext.TRIANGLE_STRIP };
}

// Low-poly prism around the Y axis: radius 0.5, height 1, centred on the origin.
// topRadius 0.5 gives a cylinder, 0 gives a cone (pyramid when segments = 4).
// Built as flat-shaded triangles (one normal per face) for a faceted toy look.
function prism(segments, topRadius, startAngle = 0) {
  const positions = [], normals = [];
  const r0 = 0.5, r1 = topRadius;
  const tri = (a, b, c, n) => { positions.push(...a, ...b, ...c); normals.push(...n, ...n, ...n); };
  const at = (i, r, y) => {
    const a = startAngle + (i / segments) * Math.PI * 2;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };
  for (let i = 0; i < segments; i++) {
    const mid = startAngle + ((i + 0.5) / segments) * Math.PI * 2;
    // Side normal tilts up by the slope (r0 - r1) over height 1.
    const len = Math.hypot(1, r0 - r1);
    const n = [Math.cos(mid) / len, (r0 - r1) / len, Math.sin(mid) / len];
    const b0 = at(i, r0, -0.5), b1 = at(i + 1, r0, -0.5);
    const t0 = at(i, r1, 0.5), t1 = at(i + 1, r1, 0.5);
    tri(b0, t1, b1, n);
    if (r1 > 0) tri(b0, t0, t1, n);
    tri([0, -0.5, 0], b0, b1, [0, -1, 0]);                 // bottom cap
    if (r1 > 0) tri([0, 0.5, 0], t1, t0, [0, 1, 0]);        // top cap
  }
  return { positions, normals };
}

export const cylinder = (segments = 12) => prism(segments, 0.5);
export const cone = (segments = 10) => prism(segments, 0);
// Square pyramid whose base fills the unit square (-0.5..0.5 in X and Z).
export function pyramid() {
  const g = prism(4, 0, Math.PI / 4);
  for (let i = 0; i < g.positions.length; i += 3) {
    g.positions[i] *= Math.SQRT2;
    g.positions[i + 2] *= Math.SQRT2;
  }
  // Re-derive side normals for the widened shape (slope is now 0.5 / 1).
  for (let i = 0; i < g.normals.length; i += 3) {
    const [x, y, z] = g.normals.slice(i, i + 3);
    if (Math.abs(y) === 1) continue;
    const h = Math.hypot(x, z), len = Math.hypot(1, 0.5);
    g.normals[i] = (x / h) / len; g.normals[i + 1] = 0.5 / len; g.normals[i + 2] = (z / h) / len;
  }
  return g;
}
