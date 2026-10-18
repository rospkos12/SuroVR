// Blocky toy models composed from unit shapes (see geometry.js).
// Units are metres. Each model stands on y = 0 with its front facing +Z, so a
// yaw rotation can turn it toward the viewer.
//
// Scale ("toybox" scale, kept consistent across models):
//   man 1.7 m tall, cat 0.33 m tall (to the ear tips), car 2 m long (half-size toy car),
//   tree 2.4 m tall, house 2.4 m tall (a playhouse rather than a full house).
//
// A part is { shape, pos: [x, y, z], size: [sx, sy, sz], rot?: [rx, ry, rz], color }.
// shape is one of 'box' | 'cylinder' | 'cone' | 'pyramid'.

const SKIN = [0.96, 0.78, 0.62];
const DARK = [0.12, 0.12, 0.14];
const GLASS = [0.65, 0.85, 1.0];

const box = (pos, size, color, rot) => ({ shape: 'box', pos, size, color, rot });

export const MODELS = {
  man: {
    label: 'Man', emoji: '🧍',
    parts: [
      box([-0.09, 0.4, 0], [0.14, 0.8, 0.16], [0.2, 0.3, 0.65]),   // legs
      box([0.09, 0.4, 0], [0.14, 0.8, 0.16], [0.2, 0.3, 0.65]),
      box([-0.09, 0.03, 0.03], [0.15, 0.06, 0.24], DARK),          // shoes
      box([0.09, 0.03, 0.03], [0.15, 0.06, 0.24], DARK),
      box([0, 1.1, 0], [0.42, 0.6, 0.24], [0.9, 0.25, 0.2]),        // body
      box([-0.28, 1.1, 0], [0.13, 0.6, 0.14], [0.9, 0.25, 0.2]),    // arms
      box([0.28, 1.1, 0], [0.13, 0.6, 0.14], [0.9, 0.25, 0.2]),
      box([-0.28, 0.75, 0], [0.11, 0.1, 0.11], SKIN),               // hands
      box([0.28, 0.75, 0], [0.11, 0.1, 0.11], SKIN),
      box([0, 1.53, 0], [0.26, 0.26, 0.26], SKIN),                  // head
      box([0, 1.68, -0.01], [0.28, 0.06, 0.28], [0.35, 0.2, 0.1]),  // hair
      box([-0.06, 1.56, 0.131], [0.04, 0.04, 0.01], DARK),          // eyes
      box([0.06, 1.56, 0.131], [0.04, 0.04, 0.01], DARK),
      box([0, 1.47, 0.131], [0.1, 0.02, 0.01], [0.7, 0.3, 0.3]),    // smile
    ],
  },
  cat: {
    label: 'Cat', emoji: '🐱',
    parts: [
      box([0, 0.14, -0.03], [0.17, 0.12, 0.36], [0.95, 0.6, 0.2]),  // body
      ...[[-0.055, 0.1], [0.055, 0.1], [-0.055, -0.15], [0.055, -0.15]].map(([x, z]) =>
        box([x, 0.04, z], [0.05, 0.08, 0.05], [0.95, 0.6, 0.2])),  // legs
      box([0, 0.22, 0.17], [0.14, 0.12, 0.12], [0.95, 0.6, 0.2]),   // head
      { shape: 'cone', pos: [-0.04, 0.305, 0.17], size: [0.05, 0.05, 0.04], color: [0.9, 0.5, 0.15] }, // ears
      { shape: 'cone', pos: [0.04, 0.305, 0.17], size: [0.05, 0.05, 0.04], color: [0.9, 0.5, 0.15] },
      box([-0.033, 0.235, 0.231], [0.025, 0.025, 0.005], [0.2, 0.6, 0.2]), // eyes
      box([0.033, 0.235, 0.231], [0.025, 0.025, 0.005], [0.2, 0.6, 0.2]),
      box([0, 0.205, 0.231], [0.02, 0.015, 0.005], [0.95, 0.5, 0.6]),     // nose
      box([0, 0.24, -0.29], [0.035, 0.035, 0.22], [0.9, 0.5, 0.15], [0.8, 0, 0]), // tail, tilted up
    ],
  },
  car: {
    label: 'Car', emoji: '🚗',
    // Long axis along X so the side of the car faces the viewer.
    parts: [
      box([0, 0.4, 0], [2.0, 0.4, 1.0], [0.2, 0.5, 0.95]),          // body
      box([-0.1, 0.77, 0], [1.1, 0.34, 0.9], [0.2, 0.5, 0.95]),     // cabin
      box([-0.1, 0.78, 0], [0.9, 0.24, 0.92], GLASS),               // side windows
      box([-0.1, 0.78, 0], [1.12, 0.24, 0.7], GLASS),               // front/back windows
      ...[[-0.65, 0.48], [0.65, 0.48], [-0.65, -0.48], [0.65, -0.48]].flatMap(([x, z]) => [
        { shape: 'cylinder', pos: [x, 0.2, z], size: [0.4, 0.16, 0.4], rot: [Math.PI / 2, 0, 0], color: DARK },  // wheel
        { shape: 'cylinder', pos: [x, 0.2, z], size: [0.2, 0.18, 0.2], rot: [Math.PI / 2, 0, 0], color: [0.8, 0.8, 0.85] }, // hubcap
      ]),
      box([1.0, 0.47, 0.3], [0.03, 0.1, 0.18], [1, 0.95, 0.5]),     // headlights
      box([1.0, 0.47, -0.3], [0.03, 0.1, 0.18], [1, 0.95, 0.5]),
      box([-1.0, 0.47, 0.3], [0.03, 0.08, 0.14], [0.9, 0.1, 0.1]),  // tail lights
      box([-1.0, 0.47, -0.3], [0.03, 0.08, 0.14], [0.9, 0.1, 0.1]),
    ],
  },
  tree: {
    label: 'Tree', emoji: '🌳',
    parts: [
      { shape: 'cylinder', pos: [0, 0.45, 0], size: [0.25, 0.9, 0.25], color: [0.5, 0.32, 0.16] }, // trunk
      { shape: 'cone', pos: [0, 1.15, 0], size: [1.4, 0.9, 1.4], color: [0.15, 0.55, 0.2] },
      { shape: 'cone', pos: [0, 1.6, 0], size: [1.1, 0.8, 1.1], color: [0.2, 0.65, 0.25] },
      { shape: 'cone', pos: [0, 2.05, 0], size: [0.75, 0.7, 0.75], color: [0.3, 0.75, 0.3] },
    ],
  },
  house: {
    label: 'House', emoji: '🏠',
    parts: [
      box([0, 0.7, 0], [2.0, 1.4, 1.6], [0.98, 0.92, 0.75]),        // walls
      { shape: 'pyramid', pos: [0, 1.9, 0], size: [2.3, 1.0, 1.9], color: [0.8, 0.25, 0.2] }, // roof
      box([0, 0.4, 0.81], [0.45, 0.8, 0.04], [0.55, 0.33, 0.15]),   // door
      box([0.13, 0.4, 0.835], [0.05, 0.05, 0.02], [0.95, 0.8, 0.2]), // door knob
      box([-0.6, 0.85, 0.81], [0.4, 0.4, 0.04], GLASS),             // windows
      box([0.6, 0.85, 0.81], [0.4, 0.4, 0.04], GLASS),
      box([0.55, 2.05, -0.3], [0.25, 0.6, 0.25], [0.6, 0.3, 0.25]), // chimney
    ],
  },
};

export const KINDS = Object.keys(MODELS);

// Axis-aligned bounding box of a model in its own space (ignoring part
// rotation): { lo: [x, y, z], hi: [x, y, z] }. Used for picking and previews.
export function modelBounds(kind) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of MODELS[kind].parts) {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], p.pos[i] - p.size[i] / 2);
      hi[i] = Math.max(hi[i], p.pos[i] + p.size[i] / 2);
    }
  }
  return { lo, hi };
}

// Largest side of the model's bounding box, used to size VR shelf previews.
export function modelExtent(kind) {
  const { lo, hi } = modelBounds(kind);
  return Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
}
