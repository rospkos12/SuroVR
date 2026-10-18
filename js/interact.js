// Pointer controls (mouse, touch, pen) for the desktop/touch preview and for
// AR's DOM overlay. One finger or the mouse:
//   - press on a toy  -> select it and drag it across the floor
//   - press elsewhere -> drag to look around (preview only)
//   - tap elsewhere   -> let go of the selected toy, or drop a new one
// Two fingers: pinch to resize the selected toy. Mouse wheel: resize too.
import * as mat4 from './mat4.js';

const TAP_SLOP = 8; // px a finger may wander and still count as a tap

// World-space ray through a point in normalised device coordinates for a
// camera { projection, world } (world = camera-to-world matrix).
export function rayFromCamera(camera, ndcX, ndcY) {
  const inv = mat4.invert(camera.projection);
  if (!inv) return null;
  const near = mat4.transformPoint(camera.world, mat4.transformPoint(inv, [ndcX, ndcY, -1]));
  const far = mat4.transformPoint(camera.world, mat4.transformPoint(inv, [ndcX, ndcY, 1]));
  const d = far.map((v, i) => v - near[i]), len = Math.hypot(...d);
  return { origin: near, dir: d.map((v) => v / len) };
}

// el: element receiving pointer events. Options:
//   enabled()     -> should this element handle input right now?
//   getCamera()   -> current { projection, world } camera
//   look(dx, dy)  -> optional: rotate the view for a drag on empty space
//   drop(ray)     -> drop a new toy for a tap on empty space
export function attachPointerControls(el, scene, { enabled, getCamera, look, drop }) {
  const pointers = new Map(); // pointerId -> { x, y }
  let gesture = null;         // { type: 'move'|'look'|'tap'|'pinch'|'none', ... }

  const rayAt = (x, y) => {
    const camera = getCamera();
    if (!camera) return null;
    const r = el.getBoundingClientRect();
    return rayFromCamera(camera, ((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2);
  };
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };
  const ignore = (e) => !enabled() || e.target.closest?.('.pane');

  el.addEventListener('pointerdown', (e) => {
    if (ignore(e)) return;
    try { el.setPointerCapture(e.pointerId); } catch { /* not critical */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      const ray = rayAt(e.clientX, e.clientY);
      const hit = ray && scene.pickHit(ray.origin, ray.dir);
      if (hit) {
        // Grab the toy at the point under the finger / cursor.
        scene.setActive(hit.obj);
        gesture = { type: 'move', moved: 0, grab: scene.startGrab(hit, ray.origin) };
      } else {
        gesture = { type: look ? 'look' : 'tap', moved: 0 };
      }
    } else if (pointers.size === 2) {
      // Second finger: switch to pinch-resize (finishing any move first).
      if (gesture?.type === 'move') scene.endEdit(gesture.grab.token);
      const obj = scene.active;
      gesture = obj ? { type: 'pinch', obj, token: scene.beginEdit(obj), d0: spread(), s0: obj.scale } : { type: 'none' };
    }
    e.preventDefault();
  });

  el.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || !gesture) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (gesture.moved !== undefined) gesture.moved += Math.abs(dx) + Math.abs(dy);

    if (gesture.type === 'look' && gesture.moved > TAP_SLOP / 2) look(dx, dy);
    else if (gesture.type === 'move') {
      const ray = rayAt(e.clientX, e.clientY);
      if (ray) scene.dragGrab(gesture.grab, ray.origin, ray.dir);
    } else if (gesture.type === 'pinch' && pointers.size >= 2) {
      scene.setScale(gesture.obj, gesture.s0 * (spread() / gesture.d0));
    }
  });

  const up = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    const g = gesture;
    if (!g) return;
    if (g.type === 'move') {
      scene.endEdit(g.grab.token);
      gesture = pointers.size ? { type: 'none' } : null;
    } else if (g.type === 'pinch') {
      scene.endEdit(g.token);
      gesture = { type: 'none' }; // ignore the remaining finger until all are up
    } else if ((g.type === 'look' || g.type === 'tap') && g.moved < TAP_SLOP && e.type === 'pointerup') {
      const ray = rayAt(e.clientX, e.clientY);
      scene.tapEmpty(() => ray && drop(ray));
      gesture = null;
    } else if (!pointers.size) {
      gesture = null;
    }
    if (!pointers.size) gesture = null;
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);

  // Mouse wheel / trackpad: resize the selected toy (one undo step per burst).
  el.addEventListener('wheel', (e) => {
    if (ignore(e) || !scene.active || !e.deltaY) return;
    e.preventDefault();
    scene.scaleBy(scene.active, e.deltaY < 0 ? 1.1 : 1 / 1.1, 'wheel');
  }, { passive: false });
}
