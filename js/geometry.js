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
