// Entry point: WebXR feature detection for the buttons, plus a non-XR
// fallback that renders the VR scene on the page canvas with drag-to-look.
import * as mat4 from './mat4.js';
import { Scene, rayFloor, rayPlane } from './scene.js';
import { startXR } from './xr.js';
import { MODELS, KINDS } from './models.js';
import { attachPointerControls } from './interact.js';

// ---------- Page elements (created if missing) ----------
// Never assume the HTML matches this script: GitHub Pages caches files for
// 10 minutes, so a browser can briefly pair a fresh main.js with a stale
// index.html (or the reverse). Anything missing is created instead of crashing.
function ensure(id, tag, parent, className) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement(tag);
    el.id = id;
    if (className) el.className = className;
    parent.appendChild(el);
  }
  return el;
}
const overlay = ensure('overlay', 'div', document.body);
const canvas = ensure('scene', 'canvas', document.body);
const statusEl = ensure('status', 'p', overlay);
const buttons = { 'immersive-vr': ensure('enter-vr', 'button', overlay), 'immersive-ar': ensure('enter-ar', 'button', overlay) };
const labels = { 'immersive-vr': 'Enter VR', 'immersive-ar': 'Enter AR' };
for (const [mode, b] of Object.entries(buttons)) if (!b.textContent) { b.textContent = labels[mode]; b.disabled = true; }

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
}

// ---------- WebGL ----------
// Try an XR-compatible context first, then a plain one (makeXRCompatible() is
// called before every XR session anyway), then the legacy name.
function createContext() {
  const base = { antialias: true, alpha: true };
  const attempts = [['webgl', { ...base, xrCompatible: true }], ['webgl', base], ['experimental-webgl', base]];
  for (const [type, attrs] of attempts) {
    try {
      const ctx = canvas.getContext(type, attrs);
      if (ctx) return ctx;
    } catch { /* try the next option */ }
  }
  return null;
}
const gl = createContext();
if (!gl) {
  for (const b of Object.values(buttons)) b.disabled = true;
  setStatus('WebGL is turned off or unavailable in this browser, so nothing can be drawn. ' +
    'In Firefox, check that hardware acceleration is on, and look for WebGL in about:support.', true);
  throw new Error('WebGL unavailable'); // stop here; the message above stays visible
}
gl.enable(gl.DEPTH_TEST);

// Show unexpected errors on the page instead of failing silently.
window.addEventListener('error', (e) => setStatus('Something went wrong: ' + e.message, true));
window.addEventListener('unhandledrejection', (e) => setStatus('Something went wrong: ' + (e.reason?.message || e.reason), true));

const scene = new Scene(gl);
let session = null; // active XRSession, if any
// Handy for poking at the scene from the console (and used by the tests).
window.suro = { scene, camera: () => (session ? scene.camera : previewCamera), view: () => ({ yaw, pitch }) };

// ---------- Object picker pane (built entirely here, from js/models.js) ----------
const picker = ensure('picker', 'div', overlay, 'pane');
picker.textContent = '';
const pickButtons = {};
for (const kind of KINDS) {
  const btn = document.createElement('button');
  btn.className = 'pick';
  btn.innerHTML = `<span class="emoji">${MODELS[kind].emoji}</span><span>${MODELS[kind].label}</span>`;
  btn.addEventListener('click', () => scene.select(kind));
  picker.appendChild(btn);
  pickButtons[kind] = btn;
}
const tools = document.createElement('div');
tools.className = 'tools';
tools.innerHTML = '<button id="undo">↩️ Undo</button><button id="clear">🧹 Clear</button>';
picker.appendChild(tools);
const undoBtn = tools.querySelector('#undo');
const clearBtn = tools.querySelector('#clear');
undoBtn.addEventListener('click', () => scene.undo());
clearBtn.addEventListener('click', () => scene.clear());

// Edit row: only shown while a placed toy is selected.
const edit = document.createElement('div');
edit.id = 'edit';
edit.innerHTML = `
  <button data-act="bigger">➕ Bigger</button>
  <button data-act="smaller">➖ Smaller</button>
  <button data-act="turn">🔄 Turn</button>
  <button data-act="delete">🗑️ Delete</button>
  <button data-act="done">✅ Done</button>`;
picker.prepend(edit);
const editActions = {
  bigger: () => scene.scaleBy(scene.active, 1.25),
  smaller: () => scene.scaleBy(scene.active, 1 / 1.25),
  turn: () => scene.turn(scene.active),
  delete: () => scene.remove(scene.active),
  done: () => scene.setActive(null),
};
for (const btn of edit.querySelectorAll('button')) btn.addEventListener('click', editActions[btn.dataset.act]);
const [biggerBtn, smallerBtn] = edit.querySelectorAll('button');

// Keep the pane in sync with the scene (selection can also change in VR).
scene.onChange = () => {
  for (const [kind, btn] of Object.entries(pickButtons)) btn.classList.toggle('selected', !scene.active && kind === scene.selected);
  undoBtn.disabled = scene.history.length === 0;
  clearBtn.disabled = scene.objects.length === 0;
  const a = scene.active;
  picker.classList.toggle('editing', !!a);
  biggerBtn.disabled = !a || a.scale >= 3.999;
  smallerBtn.disabled = !a || a.scale <= 0.2501;
};
scene.onChange();

// In AR (dom-overlay) a tap on the HTML would also fire an XR 'select' and
// drop an object behind the button. Cancelling 'beforexrselect' stops that.
for (const el of [picker, ...document.querySelectorAll('.pane')]) {
  el.addEventListener('beforexrselect', (e) => e.preventDefault());
}
// In AR the whole overlay takes touches itself (see interact.js), so cancel
// XR 'select' for all of it; xr.js only uses 'select' when there's no overlay.
overlay.addEventListener('beforexrselect', (e) => { if (scene.mode === 'ar') e.preventDefault(); });

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
      // Some desktop browsers take a long time (or never answer) while they
      // look for VR runtimes; give up after 3 s so the page doesn't hang.
      const timeout = new Promise((resolve) => setTimeout(() => resolve(false), 3000));
      try { ok = await Promise.race([navigator.xr.isSessionSupported(mode), timeout]); } catch { ok = false; }
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
          document.body.classList.remove('in-xr', 'in-ar', 'in-vr');
          scene.setMode('inline');
          detect();
          requestAnimationFrame(fallbackFrame);
        },
      });
      document.body.classList.add('in-xr', mode === 'immersive-ar' ? 'in-ar' : 'in-vr');
      for (const b of Object.values(buttons)) b.disabled = b !== btn;
      btn.textContent = mode === 'immersive-vr' ? 'Exit VR' : 'Exit AR';
      setStatus(mode === 'immersive-ar'
        ? 'Pick a toy, then tap the floor to drop it. Tap a toy to move or resize it.'
        : 'Shelf: pick a toy. Floor: drop it. Hold the trigger on a toy to move it; thumbstick resizes.');
    } catch (err) {
      setStatus('Could not start session: ' + err.message);
    }
  });
}

// ---------- Desktop / non-XR fallback ----------
const eye = [0, 1.6, 0];
const FOV = Math.PI / 3;
let yaw = 0, pitch = -0.25; // start looking slightly down at the floor
let previewCamera = null;   // { projection, world }, updated every frame

// Mouse / touch on the canvas: select, drag-move, pinch/wheel resize, drag
// on empty space to look around, tap empty floor to drop or let go.
attachPointerControls(canvas, scene, {
  enabled: () => !session,
  getCamera: () => previewCamera,
  look: (dx, dy) => {
    yaw -= dx * 0.005;
    pitch = Math.max(-1.5, Math.min(1.5, pitch - dy * 0.005));
  },
  drop: (ray) => {
    const hit = rayFloor(ray.origin, ray.dir);
    if (hit) scene.drop(hit, eye);
  },
});

// AR with dom-overlay: the overlay covers the screen and receives the touches.
// Taps drop toys where the finger points, on the surface the reticle found.
attachPointerControls(overlay, scene, {
  enabled: () => !!session && scene.mode === 'ar',
  getCamera: () => scene.camera,
  drop: (ray) => {
    if (!scene.reticle.visible) return;
    const hit = rayPlane(ray.origin, ray.dir, scene.reticle.matrix[13]);
    if (hit) scene.drop(hit, scene.viewer);
    else scene.dropAtReticle(scene.viewer);
  },
});

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
  const projection = mat4.perspective(FOV, w / h, 0.05, 100);
  previewCamera = { projection, world: mat4.mul(mat4.translation(...eye), mat4.rotationY(yaw), mat4.rotationX(pitch)) };
  scene.draw(projection, view);
}

scene.setMode('inline');
detect();
requestAnimationFrame(fallbackFrame);
