# SuroVR

A zero-library, pure HTML5 **WebXR** AR/VR toybox. No frameworks, no CDNs,
no build step: just `index.html`, a few plain ES modules and raw WebGL.

Pick a toy (🧍 Man, 🐱 Cat, 🚗 Car, 🌳 Tree, 🏠 House) and drop it into the
world. Every toy is a low-poly blocky model built in code from boxes,
cylinders, cones and a pyramid. Toys turn to face you when they land and do a
little drop-and-bounce. **Undo** removes the last toy and **Clear** removes
them all.

| Mode | Pick a toy | Drop it |
|------|------------|---------|
| **Desktop** (no headset) | Big buttons in the bottom pane | Click the floor (drag to look around) |
| **AR** (`immersive-ar`, phone) | The same pane, shown over the camera via `dom-overlay` | Tap: the toy lands on the hit-test reticle |
| **VR** (`immersive-vr`, headset) | Point the controller at the floating shelf of mini toys and pull the trigger | Point at the floor (a ring shows the spot) and pull the trigger |

In AR, taps on the pane are kept from also dropping a toy: the pane cancels
`beforexrselect`. VR has no DOM overlay, so it uses the in-world shelf instead.
The selected toy is shared between modes, and toys placed on desktop stay
when you enter or leave VR. AR uses the real room as its coordinate frame, so
toys start fresh when entering or leaving AR.

### Toy sizes

Everything uses one consistent "toybox" scale in metres: man 1.7 m tall,
cat about 0.33 m tall, car 2 m long (a half-size toy car), tree 2.4 m,
house 2.4 m tall (a playhouse rather than a full-size house). In VR and on desktop the
sky also has a few slowly spinning decoration cubes.

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

## Troubleshooting

- **Blank page or no toy buttons right after an update.** GitHub Pages lets
  browsers cache files for 10 minutes. Do a hard refresh (Ctrl+Shift+R, or
  Cmd+Shift+R on a Mac). `index.html` loads every module with a `?v=N` suffix
  through an import map, so a fresh page always gets matching scripts. Bump
  `N` in `index.html` whenever you change a JS file.
- **"WebGL is turned off or unavailable".** The browser refused to create a
  WebGL context. In Firefox, open `about:support` and check the WebGL rows,
  make sure *Settings → Performance → Use hardware acceleration* is on, and
  check that `webgl.disabled` is `false` in `about:config`.
- **Desktop Firefox has no WebXR** on most platforms, so Enter VR / Enter AR
  stay disabled. The desktop preview (pick, click to drop, drag to look,
  Undo / Clear) still works.

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**.
3. Pick branch `master` and folder `/ (root)`, then save.
4. After a minute it's live at `https://rospkos12.github.io/SuroVR/`.

`.nojekyll` tells Pages to serve the files as they are, without Jekyll processing.

## File layout

```
index.html        Page, canvas, Enter VR / Enter AR, toy picker pane (also the AR dom-overlay root)
js/main.js        Entry point: feature detection, toy picker pane, desktop fallback loop
js/xr.js          WebXR session: XRWebGLLayer, reference space, frame loop, hit-test, select
js/scene.js       Shared scene: shaders, grid, placed toys + bounce, VR shelf, controllers, reticle
js/models.js      The five toy models as lists of coloured parts (edit here to add toys)
js/gl.js          Tiny WebGL helper: shader compile/link, buffers, mesh drawing
js/mat4.js        Minimal column-major 4x4 matrix math
js/geometry.js    Procedural cube, cylinder, cone, pyramid, floor grid and reticle ring
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

## Adding a toy

Add an entry to `MODELS` in `js/models.js` with a `label`, an `emoji` and a
list of parts (`shape`, `pos`, `size`, optional `rot`, `color`). The model
should stand on `y = 0` with its front facing `+Z`. The pane button and the VR
shelf slot appear automatically.
