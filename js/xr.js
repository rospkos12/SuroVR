// WebXR session handling: request the session, set up the XRWebGLLayer and
// reference space, run the per-frame loop and route controller input:
// trigger/tap to pick, drop, select and grab-move toys, thumbstick to resize.
import * as mat4 from './mat4.js';
import { rayFloor, rayPlane } from './scene.js';

// mode: 'immersive-vr' | 'immersive-ar'. Resolves to the running XRSession.
export async function startXR(mode, gl, scene, { overlayRoot, onEnd } = {}) {
  const isAR = mode === 'immersive-ar';
  const init = isAR
    ? {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['local-floor', 'dom-overlay'],
        domOverlay: overlayRoot ? { root: overlayRoot } : undefined,
      }
    : { optionalFeatures: ['local-floor'] };

  const session = await navigator.xr.requestSession(mode, init);
  await gl.makeXRCompatible();
  // alpha:true lets the camera feed show through in AR.
  session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl, { alpha: isAR }) });

  // Prefer 'local-floor' (origin on the floor). Fall back to 'local' (origin
  // at the head) and, for VR, shift it down ~1.6 m so the grid is underfoot.
  let refSpace;
  try {
    refSpace = await session.requestReferenceSpace('local-floor');
  } catch {
    refSpace = await session.requestReferenceSpace('local');
    if (!isAR) {
      refSpace = refSpace.getOffsetReferenceSpace(new XRRigidTransform({ x: 0, y: -1.6, z: 0 }));
    }
  }

  // AR: cast a hit-test ray straight out of the viewer (screen centre).
  let hitTestSource = null;
  if (isAR) {
    const viewerSpace = await session.requestReferenceSpace('viewer');
    hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
  }

  scene.setMode(isAR ? 'ar' : 'vr');

  scene.viewer = [0, 1.6, 0]; // latest head position, so drops face the user

  // With a DOM overlay, AR touches are handled as normal pointer events by
  // interact.js (main.js cancels 'beforexrselect'), so skip XR select there.
  const useSelect = () => !(isAR && session.domOverlayState);
  const grabs = new Map(); // inputSource -> { obj, token, offset }

  // Trigger down / finger down: grab a toy if the ray hits one.
  session.addEventListener('selectstart', (event) => {
    grabs.delete(event.inputSource);
    if (!useSelect()) return;
    const ray = rayOf(event.frame.getPose(event.inputSource.targetRaySpace, refSpace));
    const hit = ray && !scene.pickShelf(ray.origin, ray.dir) && scene.pickHit(ray.origin, ray.dir);
    if (!hit) return;
    scene.setActive(hit.obj);
    grabs.set(event.inputSource, scene.startGrab(hit, ray.origin));
  });

  // Trigger up: finish a grab (one undo step).
  session.addEventListener('selectend', (event) => {
    const g = grabs.get(event.inputSource);
    if (g) { scene.endEdit(g.token); g.done = true; }
  });

  // Full click that didn't grab a toy: shelf -> choose kind, floor -> drop a
  // toy or let go of the selected one.
  session.addEventListener('select', (event) => {
    if (!useSelect()) return;
    if (grabs.get(event.inputSource)?.done) return grabs.delete(event.inputSource);
    const ray = rayOf(event.frame.getPose(event.inputSource.targetRaySpace, refSpace));
    if (!ray) return;
    const kind = scene.pickShelf(ray.origin, ray.dir);
    if (kind) return scene.select(kind);
    scene.tapEmpty(() => {
      if (!isAR) {
        const hit = rayFloor(ray.origin, ray.dir);
        if (hit) scene.drop(hit, scene.viewer);
      } else if (scene.reticle.visible) {
        // AR without overlay: drop where the tap points, on the reticle's surface.
        const hit = rayPlane(ray.origin, ray.dir, scene.reticle.matrix[13]);
        if (hit) scene.drop(hit, scene.viewer); else scene.dropAtReticle(scene.viewer);
      }
    });
  });

  let stickEdit = null; // in-progress thumbstick resize

  session.addEventListener('end', () => {
    hitTestSource?.cancel();
    for (const g of grabs.values()) if (!g.done) scene.endEdit(g.token);
    scene.camera = null;
    scene.controllers = [];
    onEnd?.();
  });

  let last = null;
  const onFrame = (time, frame) => {
    session.requestAnimationFrame(onFrame);
    scene.update(last === null ? 0 : time - last);

    const pose = frame.getViewerPose(refSpace);
    if (!pose) return; // tracking lost; skip this frame

    const p = pose.transform.position;
    scene.viewer = [p.x, p.y, p.z];
    // Camera for screen-space picking (AR overlay touches).
    const v0 = pose.views[0];
    scene.camera = { projection: v0.projectionMatrix, world: v0.transform.matrix };
    const dt = last === null ? 0 : time - last;

    // Grabbed toys follow their controller / finger ray across the floor.
    for (const [source, g] of grabs) {
      if (g.done) continue;
      const ray = rayOf(frame.getPose(source.targetRaySpace, refSpace));
      if (ray) scene.dragGrab(g, ray.origin, ray.dir);
    }

    // Thumbstick up/down resizes the selected toy (xr-standard: axes[3]).
    let stickY = 0;
    for (const source of session.inputSources) {
      const axes = source.gamepad?.axes || [];
      const y = axes.length >= 4 ? axes[3] : axes[1] || 0;
      if (Math.abs(y) > Math.abs(stickY)) stickY = y;
    }
    if (scene.active && Math.abs(stickY) > 0.4) {
      if (!stickEdit) stickEdit = scene.beginEdit(scene.active);
      scene.setScale(scene.active, scene.active.scale * Math.exp(-stickY * dt * 0.0015)); // up = bigger
    } else if (stickEdit) {
      scene.endEdit(stickEdit);
      stickEdit = null;
    }

    // VR controllers: grip box, pointer beam, and a floor reticle where the
    // first tracked-pointer ray would drop the selected object.
    scene.controllers = [];
    if (!isAR) scene.reticle.visible = false;
    for (const source of session.inputSources) {
      if (isAR || source.targetRayMode !== 'tracked-pointer') continue;
      const grip = source.gripSpace && frame.getPose(source.gripSpace, refSpace);
      const rayPose = frame.getPose(source.targetRaySpace, refSpace);
      scene.controllers.push({ grip: grip?.transform.matrix, ray: rayPose?.transform.matrix });
      const ray = rayOf(rayPose);
      if (ray && !scene.reticle.visible && !scene.pickShelf(ray.origin, ray.dir) && !scene.pickObject(ray.origin, ray.dir) && !grabs.size) {
        const hit = rayFloor(ray.origin, ray.dir);
        if (hit) { scene.reticle.visible = true; scene.reticle.matrix = mat4.translation(...hit); }
      }
    }

    // AR reticle follows the first hit-test result.
    if (hitTestSource) {
      const hit = frame.getHitTestResults(hitTestSource)[0];
      const hitPose = hit?.getPose(refSpace);
      scene.reticle.visible = !!hitPose;
      if (hitPose) scene.reticle.matrix = hitPose.transform.matrix;
    }

    last = time;
    const layer = session.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    // VR: dark sky. AR: fully transparent so the real world shows through.
    if (isAR) gl.clearColor(0, 0, 0, 0);
    else gl.clearColor(0.05, 0.05, 0.1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // One render per view (one per eye on a headset, one on a phone).
    for (const view of pose.views) {
      const vp = layer.getViewport(view);
      gl.viewport(vp.x, vp.y, vp.width, vp.height);
      scene.draw(view.projectionMatrix, view.transform.inverse.matrix);
    }
  };
  session.requestAnimationFrame(onFrame);
  return session;
}

// XRPose of a target ray -> { origin, dir }. The ray points down its -Z axis.
function rayOf(pose) {
  if (!pose) return null;
  const m = pose.transform.matrix;
  return { origin: [m[12], m[13], m[14]], dir: [-m[8], -m[9], -m[10]] };
}
