// The shared 3D scene: floor grid, lit spinning cubes, controller boxes and
// an AR reticle. Draws itself for any projection + view matrix pair, so the
// same code serves the desktop fallback and every XR view (each eye).
import * as mat4 from './mat4.js';
import * as geometry from './geometry.js';
import { createProgram, createMesh, drawMesh } from './gl.js';

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
    color *= 0.35 + 0.65 * max(dot(normalize(vNormal), light), 0.0);
  }
  gl_FragColor = vec4(color, 1.0);
}`;

export function randomColor() {
  // Bright-ish random colour so cubes stay visible.
  return [0.3 + Math.random() * 0.7, 0.3 + Math.random() * 0.7, 0.3 + Math.random() * 0.7];
}

export class Scene {
  constructor(gl) {
    this.gl = gl;
    this.prog = createProgram(gl, VS, FS);
    this.meshes = {
      cube: createMesh(gl, geometry.cube()),
      grid: createMesh(gl, geometry.grid()),
      ring: createMesh(gl, geometry.ring()),
    };
    this.cubes = [];          // { position, size, color, spin, angle }
    this.controllers = [];    // grip-pose matrices, refreshed each XR frame
    this.reticle = { visible: false, matrix: mat4.identity() };
    this.setMode('vr');
  }

  // 'vr' / 'inline': grid + demo cubes. 'ar': only what the user places.
  setMode(mode) {
    this.mode = mode;
    this.showGrid = mode !== 'ar';
    this.cubes = [];
    this.reticle.visible = false;
    if (mode !== 'ar') {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        this.addCube([Math.sin(a) * 2, 1.2 + 0.3 * Math.sin(a * 2), -Math.cos(a) * 2], randomColor(), 0.4);
      }
    }
  }

  addCube(position, color, size = 0.2, spin = true) {
    const cube = { position, size, color, spin, angle: spin ? Math.random() * Math.PI : 0 };
    this.cubes.push(cube);
    if (this.cubes.length > 100) this.cubes.shift(); // keep it bounded
    return cube;
  }

  // Put a resting cube on top of the AR reticle.
  placeAtReticle() {
    if (!this.reticle.visible) return;
    const m = this.reticle.matrix, size = 0.1;
    this.addCube([m[12], m[13] + size / 2, m[14]], randomColor(), size, false);
  }

  // Ray interaction: recolour the first cube hit, otherwise spawn one ahead.
  interact(origin, dir) {
    let best = null, bestT = Infinity;
    for (const c of this.cubes) {
      // Cheap bounding-sphere test.
      const oc = [c.position[0] - origin[0], c.position[1] - origin[1], c.position[2] - origin[2]];
      const t = oc[0] * dir[0] + oc[1] * dir[1] + oc[2] * dir[2];
      const d2 = oc[0] ** 2 + oc[1] ** 2 + oc[2] ** 2 - t * t;
      if (t > 0 && d2 < (c.size * 0.7) ** 2 && t < bestT) { best = c; bestT = t; }
    }
    if (best) best.color = randomColor();
    else this.addCube(origin.map((o, i) => o + dir[i] * 0.8), randomColor(), 0.2);
  }

  update(dt) {
    for (const c of this.cubes) if (c.spin) c.angle += dt * 0.001;
  }

  draw(projection, view) {
    const { gl, prog, meshes } = this;
    const u = prog.uniforms;
    gl.useProgram(prog.program);
    gl.uniformMatrix4fv(u.uProjection, false, projection);
    gl.uniformMatrix4fv(u.uView, false, view);

    const draw = (mesh, model, color, lit) => {
      gl.uniformMatrix4fv(u.uModel, false, model);
      gl.uniform3fv(u.uColor, color);
      gl.uniform1f(u.uLit, lit ? 1 : 0);
      drawMesh(gl, prog, mesh);
    };

    if (this.showGrid) draw(meshes.grid, mat4.identity(), [0.3, 0.6, 0.9], false);

    for (const c of this.cubes) {
      const model = mat4.mul(
        mat4.translation(...c.position),
        mat4.rotationY(c.angle),
        mat4.rotationX(c.angle * 0.7),
        mat4.scaling(c.size),
      );
      draw(meshes.cube, model, c.color, true);
    }

    for (const m of this.controllers) {
      draw(meshes.cube, mat4.multiply(m, mat4.scaling(0.04, 0.04, 0.12)), [0.9, 0.9, 0.9], true);
    }

    if (this.reticle.visible) draw(meshes.ring, this.reticle.matrix, [1, 1, 1], false);
  }
}
