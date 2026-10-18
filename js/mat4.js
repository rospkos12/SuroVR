// Minimal column-major 4x4 matrix helpers (same layout as WebGL / WebXR).
// Every function returns a new Float32Array; tiny and allocation-happy by design.

export function identity() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

// out = a * b
export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

// Multiply any number of matrices left to right: mul(A, B, C) = A * B * C.
export function mul(...ms) {
  return ms.reduce((acc, m) => multiply(acc, m));
}

export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function translation(x, y, z) {
  const m = identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

export function scaling(x, y = x, z = x) {
  const m = identity();
  m[0] = x; m[5] = y; m[10] = z;
  return m;
}

export function rotationX(a) {
  const c = Math.cos(a), s = Math.sin(a), m = identity();
  m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
  return m;
}

export function rotationY(a) {
  const c = Math.cos(a), s = Math.sin(a), m = identity();
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
  return m;
}

export function rotationZ(a) {
  const c = Math.cos(a), s = Math.sin(a), m = identity();
  m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
  return m;
}

// Rotate/scale a direction vector [x, y, z] by m (ignores translation).
export function transformDirection(m, [x, y, z]) {
  return [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z,
  ];
}
