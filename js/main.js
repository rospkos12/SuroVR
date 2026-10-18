// Entry point: WebXR feature detection for the buttons, plus a non-XR
// fallback that renders the VR scene on the page canvas with drag-to-look.
import * as mat4 from './mat4.js';
import { Scene } from './scene.js';
import { startXR } from './xr.js';

const canvas = document.getElementById('scene');
const statusEl = document.getElementById('status');
const buttons = { 'immersive-vr': document.getElementById('enter-vr'), 'immersive-ar': document.getElementById('enter-ar') };
const labels = { 'immersive-vr': 'Enter VR', 'immersive-ar': 'Enter AR' };

const gl = canvas.getContext('webgl', { xrCompatible: true, antialias: true, alpha: true });
if (!gl) throw new Error('WebGL is not available in this browser.');
gl.enable(gl.DEPTH_TEST);

const scene = new Scene(gl);
let session = null; // active XRSession, if any

function setStatus(msg) { statusEl.textContent = msg; }

// ---------- Feature detection ----------
async function detect() {
  const why = !window.isSecureContext
    ? 'WebXR needs HTTPS (or http://localhost).'
    : !navigator.xr
      ? 'This browser has no WebXR support.'
      : null;
  const notes = [];
  for (const [mode, btn] of Object.entries(buttons)) {
    let ok = false;
    if (!why) {
      try { ok = await navigator.xr.isSessionSupported(mode); } catch { ok = false; }
    }
    btn.disabled = !ok;
    btn.textContent = labels[mode];
    if (!ok && !why) notes.push(`${mode === 'immersive-vr' ? 'VR' : 'AR'} is not supported on this device.`);
  }
  setStatus(why || notes.join(' ') || 'Ready. Pick VR or AR.');
  if (why || notes.length) statusEl.textContent += ' Showing the desktop preview instead.';
}

for (const [mode, btn] of Object.entries(buttons)) {
  btn.addEventListener('click', async () => {
    if (session) return session.end(); // the active button doubles as "Exit"
    try {
      session = await startXR(mode, gl, scene, {
        overlayRoot: document.getElementById('overlay'),
        onEnd: () => {
          session = null;
          scene.setMode('inline');
          detect();
          requestAnimationFrame(fallbackFrame);
        },
      });
      for (const b of Object.values(buttons)) b.disabled = b !== btn;
      btn.textContent = mode === 'immersive-vr' ? 'Exit VR' : 'Exit AR';
      setStatus(mode === 'immersive-ar' ? 'Point at the floor or a table, then tap to place a cube.' : 'Pull the trigger to spawn or recolour cubes.');
    } catch (err) {
      setStatus('Could not start session: ' + err.message);
    }
  });
}

// ---------- Desktop / non-XR fallback ----------
const eye = [0, 1.6, 0];
let yaw = 0, pitch = 0;
let drag = null;

function cameraRotation() { return mat4.multiply(mat4.rotationY(yaw), mat4.rotationX(pitch)); }

canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: 0 };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  drag.x = e.clientX; drag.y = e.clientY;
  yaw -= dx * 0.005;
  pitch = Math.max(-1.5, Math.min(1.5, pitch - dy * 0.005));
});
canvas.addEventListener('pointerup', (e) => {
  // A click without dragging behaves like an XR "select" through that pixel.
  if (drag && drag.moved < 5) {
    const r = canvas.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = 1 - ((e.clientY - r.top) / r.height) * 2;
    const t = Math.tan(FOV / 2), aspect = r.width / r.height;
    const d = mat4.transformDirection(cameraRotation(), [nx * t * aspect, ny * t, -1]);
    const len = Math.hypot(...d);
    scene.interact(eye, d.map((v) => v / len));
  }
  drag = null;
});

const FOV = Math.PI / 3;
let lastTime = null;

function fallbackFrame(time) {
  if (session) return; // the XR loop owns rendering while a session runs
  requestAnimationFrame(fallbackFrame);
  scene.update(lastTime === null ? 0 : time - lastTime);
  lastTime = time;

  // Keep the drawing buffer matched to the displayed size.
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, w, h);
  gl.clearColor(0.05, 0.05, 0.1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  // view = inverse(T(eye) * Ry(yaw) * Rx(pitch))
  const view = mat4.mul(mat4.rotationX(-pitch), mat4.rotationY(-yaw), mat4.translation(-eye[0], -eye[1], -eye[2]));
  scene.draw(mat4.perspective(FOV, w / h, 0.05, 100), view);
}

scene.setMode('inline');
detect();
requestAnimationFrame(fallbackFrame);
