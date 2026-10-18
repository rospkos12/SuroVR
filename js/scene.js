// The shared 3D scene: floor grid, floating decoration cubes, placed toy
// objects (man, cat, car, tree, house), a VR picker shelf, controllers and a
// reticle. Draws itself for any projection + view matrix pair, so the same
// code serves the desktop fallback and every XR view (each eye).
import * as mat4 from './mat4.js';
import * as geometry from './geometry.js';
import { createProgram, createMesh, drawMesh } from './gl.js';
import { MODELS, KINDS, modelExtent, modelBounds } from './models.js';

const VS = `
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uProjection, uView, uModel;
varying vec3 vNormal;
void main() {
  vNormal = (uModel * vec4(aNormal, 0.0)).xyz;
  gl_Position = uProjection * uView * uModel * vec4(aPosition, 1.0);
}`;

const FS = `
precision mediump float;
uniform vec3 uColor;
uniform float uLit;
varying vec3 vNormal;
void main() {
  vec3 color = uColor;
  if (uLit > 0.5) {
    vec3 light = normalize(vec3(0.4, 1.0, 0.6));
    color *= 0.4 + 0.6 * max(dot(normalize(vNormal), light), 0.0);
  }
  gl_FragColor = vec4(color, 1.0);
}`;

const DROP_MS = 700;       // length of the drop + bounce animation
const MAX_OBJECTS = 60;    // keep the scene bounded
export const MIN_SCALE = 0.25, MAX_SCALE = 4;
const SHELF_Y = 0.95, SHELF_Z = -0.6, SHELF_SPACING = 0.28, PREVIEW_SIZE = 0.2;

// Pre-multiply each part's local matrix once: T(pos) * R(rot) * S(size).
const PART_MATRICES = {};
for (const kind of KINDS) {
  PART_MATRICES[kind] = MODELS[kind].parts.map((p) => {
    const [rx, ry, rz] = p.rot || [0, 0, 0];
    return {
      shape: p.shape, color: p.color,
      matrix: mat4.mul(mat4.translation(...p.pos), mat4.rotationY(ry), mat4.rotationX(rx), mat4.rotationZ(rz), mat4.scaling(...p.size)),
    };
  });
}

// Drop height for animation progress t in [0, 1]: falls, then two small bounces.
function bounce(t) {
  return 0.5 * (1 - t) ** 2 * Math.abs(Math.cos(2.5 * Math.PI * t));
}

// Ray / horizontal plane (y = height) intersection. Returns [x, height, z] or null.
export function rayPlane(origin, dir, height = 0) {
  if (Math.abs(dir[1]) < 1e-4) return null; // parallel to the plane
  const t = (height - origin[1]) / dir[1];
  return t > 0 && t < 50 ? [origin[0] + dir[0] * t, height, origin[2] + dir[2] * t] : null;
}
export const rayFloor = (origin, dir) => (dir[1] < 0 ? rayPlane(origin, dir, 0) : null);

// Bounding boxes per kind, padded so small toys (the cat) are easy to hit.
const BOUNDS = {};
for (const kind of KINDS) {
  const { lo, hi } = modelBounds(kind);
  const pad = 0.04;
  BOUNDS[kind] = {
    lo: [lo[0] - pad, 0, lo[2] - pad], hi: [hi[0] + pad, hi[1] + pad, hi[2] + pad],
    radius: Math.hypot(Math.max(-lo[0], hi[0]), Math.max(-lo[2], hi[2])), // footprint, for the ring
  };
}

const snapshot = (o) => ({ position: [...o.position], scale: o.scale, yaw: o.yaw });

export class Scene {
  constructor(gl) {
    this.gl = gl;
    this.prog = createProgram(gl, VS, FS);
    this.meshes = {
      box: createMesh(gl, geometry.cube()),
      cylinder: createMesh(gl, geometry.cylinder()),
      cone: createMesh(gl, geometry.cone()),
      pyramid: createMesh(gl, geometry.pyramid()),
      grid: createMesh(gl, geometry.grid()),
      ring: createMesh(gl, geometry.ring()),
      halo: createMesh(gl, geometry.ring(0.82, 1, 48)),
    };
    this.time = 0;
    this.selected = KINDS[0];  // toy kind the next drop will use
    this.active = null;        // the placed toy currently selected for editing
    this.onChange = null;      // called after selection / object list changes
    this.objects = [];         // { kind, position, yaw, scale, born }
    this.history = [];         // undo stack (see undo())
    this.decor = [];           // floating spinning cubes (VR / desktop only)
    this.controllers = [];     // { grip?, ray? } matrices, refreshed each XR frame
    this.reticle = { visible: false, matrix: mat4.identity() };
    this.mode = 'inline';
    this.setMode('inline');
  }

  changed() { this.onChange?.(); }

  // 'vr' / 'inline': grid + decoration (+ shelf in VR). 'ar': objects only.
  // Placed objects are kept between VR and desktop.
  setMode(mode) {
    // AR uses the real room as its coordinate frame, so objects placed in VR /
    // desktop wouldn't line up there (and vice versa): start fresh.
    if ((mode === 'ar') !== (this.mode === 'ar')) { this.objects = []; this.history = []; this.active = null; }
    this.mode = mode;
    this.showGrid = mode !== 'ar';
    this.showShelf = mode === 'vr';
    this.reticle.visible = false;
    this.decor = [];
    if (mode !== 'ar') {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        this.decor.push({ position: [Math.sin(a) * 6, 3 + Math.sin(a * 3) * 0.5, -Math.cos(a) * 6], angle: a, color: [0.4 + 0.5 * Math.abs(Math.sin(a)), 0.5, 0.4 + 0.5 * Math.abs(Math.cos(a))] });
      }
    }
    this.changed();
  }

  // Choose the toy kind for the next drop (also lets go of any selected toy).
  select(kind) {
    if (!MODELS[kind]) return;
    this.selected = kind;
    this.active = null;
    this.changed();
  }

  // Select a placed toy for moving / resizing (null to let go).
  setActive(obj) {
    this.active = obj;
    this.changed();
  }

  // Place the selected kind at a floor point, turned to face `viewer`.
  drop(position, viewer) {
    const yaw = viewer ? Math.atan2(viewer[0] - position[0], viewer[2] - position[2]) : 0;
    const obj = { kind: this.selected, position, yaw, scale: 1, born: this.time };
    this.objects.push(obj);
    if (this.objects.length > MAX_OBJECTS) this.objects.shift();
    this.history.push({ type: 'add', obj });
    this.changed();
    return obj;
  }

  // AR: drop on the current hit-test reticle.
  dropAtReticle(viewer) {
    if (!this.reticle.visible) return null;
    const m = this.reticle.matrix;
    return this.drop([m[12], m[13], m[14]], viewer);
  }

  // Tap on empty space: let go of the selected toy, or drop a new one.
  tapEmpty(dropFn) {
    if (this.active) this.setActive(null);
    else dropFn();
  }

  // ---- Editing (each edit is one undo step) ----

  // Start an edit: returns a token to pass to endEdit() when it's finished.
  beginEdit(obj) { return { obj, before: snapshot(obj) }; }

  // Record the edit if anything changed. `merge` folds repeated small edits
  // of the same kind (mouse-wheel notches) into one undo step.
  endEdit(token, merge = null) {
    if (!token) return;
    const { obj, before } = token, now = snapshot(obj);
    if (JSON.stringify(now) === JSON.stringify(before)) return;
    const top = this.history[this.history.length - 1];
    if (merge && top?.type === 'edit' && top.obj === obj && top.merge === merge && this.time - top.at < 1000) {
      top.at = this.time; // keep the older "before"
    } else {
      this.history.push({ type: 'edit', obj, before, merge, at: this.time });
    }
    this.changed();
  }

  setScale(obj, s) { obj.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s)); }

  scaleBy(obj, factor, merge = null) {
    if (!obj) return;
    const t = this.beginEdit(obj);
    this.setScale(obj, obj.scale * factor);
    this.endEdit(t, merge);
  }

  turn(obj, angle = Math.PI / 4) {
    if (!obj) return;
    const t = this.beginEdit(obj);
    obj.yaw += angle;
    this.endEdit(t);
  }

  remove(obj) {
    const index = this.objects.indexOf(obj);
    if (index < 0) return;
    this.objects.splice(index, 1);
    this.history.push({ type: 'delete', obj, index });
    if (this.active === obj) this.active = null;
    this.changed();
  }

  // Undo the last placement, move, resize, turn, delete or clear.
  undo() {
    const step = this.history.pop();
    if (!step) return;
    if (step.type === 'add') {
      const i = this.objects.indexOf(step.obj);
      if (i >= 0) this.objects.splice(i, 1);
      if (this.active === step.obj) this.active = null;
    } else if (step.type === 'edit') {
      Object.assign(step.obj, snapshot(step.before));
    } else if (step.type === 'delete') {
      this.objects.splice(Math.min(step.index, this.objects.length), 0, step.obj);
    } else if (step.type === 'clear') {
      this.objects = step.objects;
    }
    this.changed();
  }

  clear() {
    if (!this.objects.length) return;
    this.history.push({ type: 'clear', objects: this.objects });
    this.objects = [];
    this.active = null;
    this.changed();
  }

  // ---- Picking ----

  // Nearest placed toy hit by the ray, or null.
  pickObject(origin, dir) { return this.pickHit(origin, dir)?.obj || null; }

  // Nearest toy hit (oriented bounding box test): { obj, point } or null.
  pickHit(origin, dir) {
    let best = null, bestT = Infinity;
    for (const o of this.objects) {
      // Ray into the toy's local space: undo translation, yaw and scale.
      const c = Math.cos(-o.yaw), s = Math.sin(-o.yaw);
      const ox = origin[0] - o.position[0], oy = origin[1] - o.position[1], oz = origin[2] - o.position[2];
      const lo = [(c * ox + s * oz) / o.scale, oy / o.scale, (-s * ox + c * oz) / o.scale];
      const ld = [(c * dir[0] + s * dir[2]) / o.scale, dir[1] / o.scale, (-s * dir[0] + c * dir[2]) / o.scale];
      const { lo: bmin, hi: bmax } = BOUNDS[o.kind];
      let t0 = 0, t1 = Infinity;
      for (let i = 0; i < 3 && t0 <= t1; i++) {
        if (Math.abs(ld[i]) < 1e-9) {
          if (lo[i] < bmin[i] || lo[i] > bmax[i]) t0 = Infinity;
          continue;
        }
        let ta = (bmin[i] - lo[i]) / ld[i], tb = (bmax[i] - lo[i]) / ld[i];
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      }
      if (t0 <= t1 && t0 < bestT) { best = o; bestT = t0; }
    }
    return best && { obj: best, point: origin.map((v, i) => v + dir[i] * bestT) };
  }

  // Start dragging a toy along the floor: the toy keeps the same offset from
  // the point where the ray first touched it. Drag on a horizontal plane at
  // that point's height (kept below the eye so the motion doesn't flip).
  startGrab(hit, origin) {
    const obj = hit.obj;
    const height = Math.min(hit.point[1], origin[1] - 0.25);
    return { obj, height, token: this.beginEdit(obj),
      offset: [obj.position[0] - hit.point[0], obj.position[2] - hit.point[2]] };
  }

  // Move a grabbed toy to follow a new ray. Ignores rays that miss the drag
  // plane or would fling the toy more than 15 m away.
  dragGrab(grab, origin, dir) {
    const p = rayPlane(origin, dir, grab.height);
    if (!p || Math.hypot(p[0] - origin[0], p[2] - origin[2]) > 15) return;
    grab.obj.position[0] = p[0] + grab.offset[0];
    grab.obj.position[2] = p[2] + grab.offset[1];
  }

  shelfPosition(i) {
    return [(i - (KINDS.length - 1) / 2) * SHELF_SPACING, SHELF_Y, SHELF_Z];
  }

  // Which shelf preview (if any) does the ray point at?
  pickShelf(origin, dir) {
    if (!this.showShelf) return null;
    let best = null, bestT = Infinity;
    KINDS.forEach((kind, i) => {
      const p = this.shelfPosition(i);
      const c = [p[0] - origin[0], p[1] + PREVIEW_SIZE / 2 - origin[1], p[2] - origin[2]];
      const t = c[0] * dir[0] + c[1] * dir[1] + c[2] * dir[2];
      const d2 = c[0] ** 2 + c[1] ** 2 + c[2] ** 2 - t * t;
      if (t > 0 && d2 < 0.13 ** 2 && t < bestT) { best = kind; bestT = t; }
    });
    return best;
  }

  update(dt) {
    this.time += dt;
  }

  draw(projection, view) {
    const { gl, prog, meshes } = this;
    const u = prog.uniforms;
    gl.useProgram(prog.program);
    gl.uniformMatrix4fv(u.uProjection, false, projection);
    gl.uniformMatrix4fv(u.uView, false, view);

    const draw = (mesh, model, color, lit = true) => {
      gl.uniformMatrix4fv(u.uModel, false, model);
      gl.uniform3fv(u.uColor, color);
      gl.uniform1f(u.uLit, lit ? 1 : 0);
      drawMesh(gl, prog, mesh);
    };
    const drawModel = (kind, base) => {
      for (const part of PART_MATRICES[kind]) draw(meshes[part.shape], mat4.multiply(base, part.matrix), part.color);
    };

    if (this.showGrid) draw(meshes.grid, mat4.identity(), [0.3, 0.6, 0.9], false);

    const spin = this.time * 0.001;
    for (const d of this.decor) {
      draw(meshes.box, mat4.mul(mat4.translation(...d.position), mat4.rotationY(spin + d.angle), mat4.rotationX(spin * 0.7), mat4.scaling(0.5)), d.color);
    }

    // Placed toys, with a short drop + bounce when they first appear.
    for (const o of this.objects) {
      const t = Math.min(1, (this.time - o.born) / DROP_MS);
      const [x, y, z] = o.position;
      drawModel(o.kind, mat4.mul(mat4.translation(x, y + bounce(t) * o.scale, z), mat4.rotationY(o.yaw), mat4.scaling(o.scale)));
    }

    // Selected toy: a gently pulsing yellow ring around its feet.
    if (this.active) {
      const o = this.active, pulse = 1 + 0.06 * Math.sin(this.time * 0.006);
      const r = (BOUNDS[o.kind].radius * o.scale + 0.08) * pulse;
      draw(meshes.halo, mat4.mul(mat4.translation(o.position[0], o.position[1] + 0.01, o.position[2]), mat4.scaling(r)), [1, 0.85, 0.15], false);
    }

    // VR picker shelf: a board with a small spinning preview of each model.
    if (this.showShelf) {
      const mid = this.shelfPosition((KINDS.length - 1) / 2);
      draw(meshes.box, mat4.mul(mat4.translation(mid[0], SHELF_Y - 0.015, SHELF_Z), mat4.scaling(SHELF_SPACING * KINDS.length, 0.03, 0.26)), [0.35, 0.25, 0.2]);
      KINDS.forEach((kind, i) => {
        const p = this.shelfPosition(i);
        const isSel = kind === this.selected;
        const s = (PREVIEW_SIZE / modelExtent(kind)) * (isSel ? 1.25 : 1);
        drawModel(kind, mat4.mul(mat4.translation(p[0], p[1] + (isSel ? 0.03 : 0), p[2]), mat4.rotationY(isSel ? spin * 2 : 0.4), mat4.scaling(s)));
        if (isSel) draw(meshes.ring, mat4.mul(mat4.translation(p[0], p[1] + 0.002, p[2]), mat4.scaling(1.3)), [1, 0.85, 0.2], false);
      });
    }

    for (const c of this.controllers) {
      if (c.grip) draw(meshes.box, mat4.multiply(c.grip, mat4.scaling(0.04, 0.04, 0.12)), [0.9, 0.9, 0.9]);
      // Thin 3 m beam along the target ray's -Z axis.
      if (c.ray) draw(meshes.box, mat4.mul(c.ray, mat4.translation(0, 0, -1.5), mat4.scaling(0.004, 0.004, 3)), [1, 0.85, 0.2], false);
    }

    if (this.reticle.visible) draw(meshes.ring, this.reticle.matrix, [1, 1, 1], false);
  }
}
