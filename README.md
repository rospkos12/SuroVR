# SuroVR

A zero-library, pure HTML5 **WebXR** AR/VR starter. No frameworks, no CDNs,
no build step: just `index.html`, a few plain ES modules and raw WebGL.

- **VR** (`immersive-vr`): floor grid, lit spinning cubes, simple controller
  boxes. Pull the trigger to spawn a cube, or point at a cube to recolour it.
- **AR** (`immersive-ar`): camera passthrough with a hit-test reticle. Tap to
  place a cube on the detected floor or table.
- **Desktop fallback**: no headset? The VR scene renders on the page. Drag to
  look around, click to spawn or recolour cubes.

The *Enter VR* / *Enter AR* buttons are feature-detected with
`navigator.xr.isSessionSupported()`. They stay disabled, with a message, when
the device can't do that mode or the page isn't in a secure context.

## Run locally

```sh
git clone https://github.com/rospkos12/SuroVR.git
cd SuroVR
python3 -m http.server 8000
# open http://localhost:8000
```

WebXR only works in a **secure context**: `https://…` or `http://localhost`.
Opening the file directly (`file://`) won't work because ES modules need a server.

### Testing on real devices

| What | Browser |
|------|---------|
| AR   | Chrome on an ARCore-capable Android phone |
| VR   | Meta Quest Browser (Quest 2 / 3 / Pro) |
| Desktop | Any modern browser; you get the non-XR fallback |

A phone or headset can't reach your laptop's `localhost`, so use one of these:

- **GitHub Pages** (below): HTTPS out of the box.
- **Android + USB**: `adb reverse tcp:8000 tcp:8000`, then open
  `http://localhost:8000` in Chrome on the phone.
- **Quest**: the same `adb reverse` trick works over USB with developer mode on.
- An HTTPS tunnel (for example `cloudflared` or `ngrok`) to your local server.

On desktop Chrome, the
[Immersive Web Emulator](https://github.com/meta-quest/immersive-web-emulator)
extension can fake a headset for quick checks.

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Pick branch `master` and folder `/ (root)`, then save.
4. After a minute it's live at `https://rospkos12.github.io/SuroVR/`.

`.nojekyll` tells Pages to serve the files as they are, without Jekyll processing.

## File layout

```
index.html        Landing page, canvas, Enter VR / Enter AR buttons, AR dom-overlay root
js/main.js        Entry point: feature detection, button wiring, desktop fallback loop
js/xr.js          WebXR session: XRWebGLLayer, reference space, frame loop, hit-test, select
js/scene.js       Shared scene: shaders, grid, cubes, controllers, reticle, ray picking
js/gl.js          Tiny WebGL helper: shader compile/link, buffers, mesh drawing
js/mat4.js        Minimal column-major 4x4 matrix math
js/geometry.js    Procedural cube, floor grid and reticle ring
.nojekyll         Serve as-is on GitHub Pages
```

## How it works (short version)

1. `navigator.xr.requestSession(mode, features)` with `local-floor` as an optional
   feature, plus `hit-test` (required) and `dom-overlay` (optional) for AR.
2. `gl.makeXRCompatible()`, then `session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) })`.
3. Ask for the `local-floor` reference space, falling back to `local`. In VR the
   fallback is shifted down 1.6 m so the floor still sits underfoot.
4. Each frame: `frame.getViewerPose(refSpace)`, bind the layer's framebuffer,
   then for every view set the viewport and draw with
   `view.projectionMatrix` and `view.transform.inverse.matrix`.
5. AR clears to fully transparent (alpha 0), so the camera feed shows through.
