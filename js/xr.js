// WebXR session handling: request the session, set up the XRWebGLLayer and
// reference space, run the per-frame loop and route 'select' input.
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

  // 'select' = trigger press / screen tap.
  session.addEventListener('select', (event) => {
    if (isAR) return scene.placeAtReticle();
    const pose = event.frame.getPose(event.inputSource.targetRaySpace, refSpace);
    if (!pose) return;
    const m = pose.transform.matrix; // target ray points down its -Z axis
    scene.interact([m[12], m[13], m[14]], [-m[8], -m[9], -m[10]]);
  });

  session.addEventListener('end', () => {
    hitTestSource?.cancel();
    scene.controllers = [];
    onEnd?.();
  });

  let last = null;
  const onFrame = (time, frame) => {
    session.requestAnimationFrame(onFrame);
    scene.update(last === null ? 0 : time - last);
    last = time;

    const pose = frame.getViewerPose(refSpace);
    if (!pose) return; // tracking lost; skip this frame

    // Controller grip poses (VR) for drawing simple controller boxes.
    scene.controllers = [];
    for (const source of session.inputSources) {
      if (!source.gripSpace) continue;
      const grip = frame.getPose(source.gripSpace, refSpace);
      if (grip) scene.controllers.push(grip.transform.matrix);
    }

    // AR reticle follows the first hit-test result.
    if (hitTestSource) {
      const hit = frame.getHitTestResults(hitTestSource)[0];
      const hitPose = hit?.getPose(refSpace);
      scene.reticle.visible = !!hitPose;
      if (hitPose) scene.reticle.matrix = hitPose.transform.matrix;
    }

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
