// The shared 3D scene: floor grid, floating decoration cubes, placed toy
// objects (man, cat, car, tree, house), a VR picker shelf, controllers and a
// reticle. Draws itself for any projection + view matrix pair, so the same
// code serves the desktop fallback and every XR view (each eye).
import * as mat4 from './mat4.js';
import * as geometry from './geometry.js';
import { createProgram, createMesh, drawMesh } from './gl.js';
import { MODELS, KINDS, modelExtent } from './models.js';

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

// Ray / horizontal plane (y = 0) intersection. Returns [x, 0, z] or null.
export function rayFloor(origin, dir) {
  if (dir[1] > -1e-4) return null; // pointing level or up: never hits the floor
  const t = -origin[1] / dir[1];
  return t > 0 && t < 50 ? [origin[0] + dir[0] * t, 0, origin[2] + dir[2] * t] : null;
}

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
    };
    this.time = 0;
    this.selected = KINDS[0];
    this.onChange = null;     // called after selection / object list changes
    this.objects = [];        // { kind, position, yaw, born }
    this.decor = [];          // floating spinning cubes (VR / desktop only)
    this.controllers = [];    // { grip?, ray? } matrices, refreshed each XR frame
    this.reticle = { visible: false, matrix: mat4.identity() };
    this.mode = 'inline';
    this.setMode('inline');
  }

  // 'vr' / 'inline': grid + decoration (+ shelf in VR). 'ar': objects only.
  // Placed objects are kept between VR and desktop.
  setMode(mode) {
    // AR uses the real room as its coordinate frame, so objects placed in VR /
    // desktop wouldn't line up there (and vice versa): start fresh.
    if ((mode === 'ar') !== (this.mode === 'ar')) this.objects = [];
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
  }

  select(kind) {
    if (!MODELS[kind]) return;
    this.selected = kind;
    this.onChange?.();
  }

  // Place the selected object at a floor point, turned to face `viewer`.
  drop(position, viewer) {
    const yaw = viewer ? Math.atan2(viewer[0] - position[0], viewer[2] - position[2]) : 0;
    this.objects.push({ kind: this.selected, position, yaw, born: this.time });
    if (this.objects.length > MAX_OBJECTS) this.objects.shift();
    this.onChange?.();
  }

  undo() { this.objects.pop(); this.onChange?.(); }
  clear() { this.objects = []; this.onChange?.(); }

  // AR: drop on the current hit-test reticle.
  dropAtReticle(viewer) {
    if (!this.reticle.visible) return;
    const m = this.reticle.matrix;
    this.drop([m[12], m[13], m[14]], viewer);
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

  // Controller / mouse ray: select from the shelf, otherwise drop on the floor.
  // Returns 'select', 'drop' or null.
  interact(origin, dir, viewer = origin) {
    const kind = this.pickShelf(origin, dir);
    if (kind) { this.select(kind); return 'select'; }
    const hit = rayFloor(origin, dir);
    if (hit) { this.drop(hit, viewer); return 'drop'; }
    return null;
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

    // Placed objects, with a short drop + bounce when they first appear.
    for (const o of this.objects) {
      const t = Math.min(1, (this.time - o.born) / DROP_MS);
      const [x, y, z] = o.position;
      drawModel(o.kind, mat4.multiply(mat4.translation(x, y + bounce(t), z), mat4.rotationY(o.yaw)));
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
