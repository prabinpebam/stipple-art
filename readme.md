# Stipple Art Generator

## by Prabin Pebam

The **Stipple Art Generator** is an interactive tool that transforms an image into stipple art using a **weighted Voronoi stippling algorithm**. It allows you to control various parameters such as stipple count, iteration count, dot size, and colorization to generate custom stipple patterns.

![Stipple art examples](/images/stipple-art-examples.png "Stipple art examples")
The studio interface supports light and dark themes, a responsive canvas workspace,
and custom controls with keyboard focus states.


Play with stipple art generator here
[Stipple art generator](https://prabinpebam.github.io/stipple-art/)


---

## Approach

This project utilizes a **Voronoi-based stippling algorithm**, which distributes points (stipple dots) in a way that represents the brightness of an image. The core idea is to use **Monte Carlo sampling** and **Lloyd's relaxation** to iteratively adjust dot positions to achieve an optimal stippling effect.

### Steps:
1. **Image Processing:**
   - You upload an image, which is then processed to extract pixel brightness values.
2. **Initial Stipple Placement:**
   - Points are randomly seeded across the image, weighted based on brightness.
3. **Weighted Voronoi Relaxation:**
   - Each stipple point is adjusted by computing the weighted centroid of its Voronoi cell.
   - The weight is determined by the brightness of the corresponding image region.
   - This step is repeated over multiple iterations to refine dot placement.
4. **Rendering the Stipple Art:**
   - The dots are drawn on a **HTML5 canvas**, with options for colorized dots based on the original image.
5. **Animation Mode (Optional):**
   - The stippling process can be animated in real-time, continuously adjusting dot positions.
6. **Exporting as SVG:**
   - Once the stipple art is generated, you can download it as an **SVG** file for scalable output.

---

## How the Code Works

The project is a static browser app with no build step:

### 1. **index.html**
- Defines the semantic studio layout using custom components and native form controls.
- Contains:
  - **Canvas** for rendering stipple art.
  - **Control panel** for adjusting parameters like stipple count, dot size, and animation.
  - **File upload** functionality for selecting an image.
  - **Download button** to export the stipple art as SVG.

### 2. **stipple-art.js**
- Implements the stippling algorithm using:
  - **D3 Delaunay** for Voronoi computations.
  - **Monte Carlo sampling** for computing weighted centroids.
  - **Canvas API** for rendering.
  - **Event listeners** to handle image uploads, parameter changes, and button actions.

#### Key Functions:
- `generateStippleArt()` → Generates stipple points and iteratively refines their positions.
- `renderStippleArt()` → Draws the stipple points onto the canvas.
- `animateVoronoi()` → Continuously animates the stippling process.
- `downloadSVG()` → Converts stipple art to an SVG format for download.
- `getBrightness()` → Extracts brightness values from the uploaded image.
- `computeWeightedCentroid()` → Determines the best position for a stipple point within its Voronoi cell.

### 3. **design-system.css**
- Centralizes the Clawpilot light/dark palette and design tokens for typography,
  spacing, radii, control sizes, borders, and motion.
- Defines reusable buttons, fields, sliders, switches, segmented controls,
  upload cards, badges, progress cards, and panel components.
- Adapts from a canvas-and-sidebar desktop layout to a stacked mobile layout.
- Keeps the desktop preview nearly edge-to-edge and full-height. Branding, theme,
  introduction, privacy information, navigation help, and generation progress live
  in the side panel; only image status, a compact resolution state, and zoom
  controls surround the canvas.
- Uses compact property-panel spacing, inline numeric fields, and single-row
  shape/orientation pickers. Routine hints are not shown in the sidebar; detailed
  image information remains in the resolution popover. Touch controls retain
  larger targets.
- Desktop scrolling is confined to the settings panel; the canvas flexes to the
  viewport height without forcing body overflow when settings or zoom change.
  The stacked mobile layout retains normal page scrolling.
- Slider rows reserve separate label, numeric-value/unit, and slider columns,
  keeping row dimensions stable throughout each control's value range.
- Proximity spacing uses 4px between a heading and its control, 8px between
  related rows, 12px between independent fields, and 16px between property groups.
- Section headings use small uppercase tracked text; property headings use
  stronger sentence-case text; individual field labels use lighter text.
  Nested radius controls have an inset guide to reinforce their grouping.
- Shape choices use icons with hover titles and accessible radio names.
- Includes keyboard focus indicators and reduced-motion support.
- Keeps ink/paper tokens fixed across app themes so changing the interface theme
  does not change the artwork or exported SVG.
- Shape and orientation pickers reuse the segmented-control component.

### 4. **studio-ui.js**
- Applies the system color scheme before first paint and remembers manual theme
  selection in local storage. If storage is unavailable, the theme still works
  for the current visit and a diagnostic is logged.
- Supports `?scoutTheme=light` or `?scoutTheme=dark` for explicit preview themes.
- Updates slider values and filled tracks, handles the empty-state upload button,
  and displays drag-and-drop feedback.

### 5. **shape-geometry.js**
- Supplies regular square, triangle, and hexagon vertices for shared canvas/SVG
  geometry. Dots continue to use circles.
- Computes the major axis of each Voronoi cell from polygon area moments.
- Has dependency-free regression tests in `shape-geometry.test.js`.

### 6. **preview-viewport.js**
- Implements zoom and pan as a separate view transform, independent of artwork
  generation, shape geometry, and export.
- Batches navigation and scene updates into one canvas drawing frame.
- Includes dependency-free zoom anchoring and pan-bounds tests in
  `preview-viewport.test.js`.

### 7. **image-import.js**
- Validates file size, sniffs format signatures and common raster dimensions,
  and selects an appropriate browser decoder.
- Uses Blob URLs or asynchronous bitmap decoding rather than base64 copies.
- Produces one bounded working canvas and reusable RGBA pixel buffer.
- Has dependency-free import tests in `image-import.test.js`.

## Large images and image formats

**Working resolution** limits the longest image edge:

| Mode | Longest edge | Maximum working RGBA buffer |
| --- | --- | --- |
| Fast | 1,024 px | 4 MiB |
| Balanced (default) | 2,048 px | 16 MiB |
| Detail | 4,096 px | 64 MiB |

Aspect ratio is retained, with dimensions rounded to whole pixels. Small images
are never enlarged. Source and working dimensions, compressed file size, pixel
buffer size, and detected format appear in the working-resolution popover. The original
file is retained locally so switching resolution can rebuild from the source,
not from a previously downsampled image. Changing resolution resets generated
artwork and the preview view.

The bottom-left preview control shows only the current preset (for example
**Balanced · 2K**). Open it to see the three presets and image details. The popover
closes on selection, outside click, Escape, or viewport resize; resolution inputs
remain associated with the settings form and are locked during processing.

The pixel buffer is prepared once per import and reused across generation runs.
Temporary decoded bitmaps are closed and Blob URLs revoked. Replaced working
canvases are released. Source transparency is retained, never flattened onto a
background color. Fully transparent pixels receive zero stippling weight, and
partially transparent pixels contribute proportionally to their alpha. Color
sampling excludes invisible RGB values. Transparent artwork has no paper fill;
each mark retains the alpha at its original position in both preview renderers
and exports. Shapes are not clipped to the source silhouette: increasing radius
or displacing particles lets the entire shape extend into formerly empty areas.
Opaque images retain the selected ink/paper background. SVG shapes stay fully vector.
The preview displays transparent regions over the selected ink/paper background:
black-on-white always displays white paper, including in dark app mode.
This viewing background is not baked into transparent source pixels or exports.

| Formats | Support |
| --- | --- |
| JPEG / JFIF, PNG / APNG, WebP, AVIF, GIF, BMP, ICO | Browser-native decoding; availability depends on the browser |
| SVG | Browser image-element decoding, rasterized at the working resolution |
| HEIC / HEIF, TIFF, JPEG XL | Attempted through browser decoders; **not universally supported** |
| Other `image/*` files | Attempted if the browser can decode them |
| Camera RAW, PSD, PDF | No bundled decoder; convert to a supported image first |

Animated images are captured as a single still frame; they are not imported as
animations. Native bitmap decoding uses the first frame. JPEG EXIF orientation
is honored by the browser and included in sniffed source dimensions.
Missing or generic MIME types are accepted when a known signature or image
extension identifies the file. Corrupt files and unsupported codecs show inline
errors with conversion guidance; failed imports preserve the previous image and
artwork and restore its processing settings.

Uploads are limited to **100 MiB**, source dimensions to **100 megapixels** and
**65,535 px per edge**. PNG, JPEG, GIF, BMP, and common WebP headers are checked
before decoding, using at most 256 KiB of header data. Other formats, or dimensions
not found within that header, are checked after decoding. Bitmap resize hints
are supplied when dimensions are known. Browser decoding can still use temporary
full-source memory: these limits bound working data, not every internal decoder
allocation. A decoder request times out after 60 seconds; a late bitmap is closed.
No files are uploaded, and no additional codec libraries or services are required.

## Mouse interaction

The **Sound** switch uses a real [sand-pouring recording by nicoproson](https://freesound.org/people/nicoproson/sounds/627070/),
bundled as `audio/sand-pour.mp3` under CC0 (see `audio/LICENSE.txt`).
Web Audio granular playback selects energetic portions of the recording and
overlaps three short grains with Hann envelopes to avoid abrupt starts/stops
and obvious loop seams. A 40ms look-ahead scheduler schedules grains on the audio
clock rather than relying on animation-frame timing. Playback rate, volume,
filter brightness, and stereo placement respond to actual particle motion.
The recording loads locally on the first audio-unlocking gesture, with explicit
load/decode errors and no synthesized fallback. Serve the app over HTTP to use
audio; browsers may block fetching the recording from a `file:` page.
Original colors, Mouse interaction, and Sound are enabled by default.
Audio is unlocked on the first click/tap or keypress (browser autoplay rules).
Volume and filter brightness
follow visible particle speed, while stereo position follows the speed-weighted
particle location. Returning particles keep rustling after the cursor leaves;
settled particles are silent. Sound mutes on blur, hidden tabs, disabled interaction,
and scene resets. It is not included in exports.

Enable **Mouse interaction** in Appearance, then move the mouse over generated
artwork. Nearby shapes repel and swirl in the cursor's wake, coast, and slowly
return to their original positions when the cursor moves away. This is a
preview-only effect: SVG and PNG exports always use the undisturbed artwork.
Mouse dragging still pans; wheel zoom, touch navigation, and keyboard navigation
are unchanged. Interaction pauses during import/refinement/Voronoi animation and
resets when the artwork changes. Reduced-motion preferences disable the effect.
Hidden tabs discard transient motion instead of accumulating simulation time.

### Research and implementation

The chosen model combines established techniques rather than a full fluid solver:

- [Daniel Shiffman, *The Nature of Code*: Forces](https://natureofcode.com/forces/)
  explains force accumulation and acceleration for interactive particles.
- [Craig Reynolds: Steering Behaviors](https://www.red3d.com/cwr/steer/) provides
  the flee/seek/arrival framework for local avoidance and returning to a target.
- [Magnetic particle example](https://webdevpuneet.com/ui-snippets/three-magnetic-particles/)
  describes exactly the home-position spring, proximity-weighted cursor
  repulsion, and velocity damping pattern used in interactive particle fields.
- [Glenn Fiedler: Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/)
  explains fixed integration steps and bounded catch-up to avoid unstable springs
  and runaway work after long frames.
- [GPU Gems 38: Fast Fluid Dynamics](https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu)
  describes a true grid-based stable-fluids solver. Pressure/advection passes
  are valuable for smoke/liquid, but unnecessary for this home-anchored effect.

`particle-field.js` uses a damped spring toward each cached home position, a
smooth finite-radius repulsive force, cursor-velocity impulses, and deterministic
tangential agitation for a fluid-like wake. It is **not a physical fluid simulation**
and does not calculate particle collisions. A fixed 120 Hz semi-implicit update
with at most eight catch-up steps keeps forces stable; tiny motions snap exactly
home so rendering stops when settled. Force radius/speed are measured in screen
pixels and converted by zoom. State is stored in typed displacement/velocity
arrays, separate from point geometry, colors, and per-mark opacity.
Renderers translate cached shapes, cull their displaced positions, and reuse the
existing frame scheduler and instanced GPU draw. No Voronoi rebuilding or color
sampling occurs during mouse interaction. Particles carry their original opacity
as they move; no source-image mask clips them.

## Preview navigation

After uploading an image, use the preview's **- / +**, percentage, and **Fit**
controls. Zoom ranges from **25% to 800%**, relative to the fitted canvas
(100% means fit, not the image's native pixel size).

- Mouse wheel / trackpad vertical scroll zooms around the cursor over the canvas.
  Scroll elsewhere to scroll the page or settings.
- Drag with the primary or middle mouse button to pan. Pointer capture keeps the
  drag active when the pointer leaves the preview.
- On touch, drag with one finger to pan or pinch with two fingers to zoom and pan.
- Double-click to zoom in; Shift-double-click to zoom out.
- With the preview focused, use **+ / -** to zoom, **arrow keys** to pan, and
  **0** or **Home** to fit.

Pan bounds prevent losing the canvas off-screen. New image uploads reset to fit;
appearance changes and generation preserve the current view. Resizing preserves
the relative view position. Navigation remains available during refinement and
animation, but is disabled while loading an image.

The vector-backed preview uses `preview-renderer.js`, with `preview-gpu.js` for
WebGL2 acceleration. Geometry and colors are cached when artwork changes.
WebGL2 draws visible circles and regular polygons as instanced quads with analytic,
antialiased shape edges, in one draw call. Browsers without WebGL2 use cached
Canvas `Path2D` objects instead and log the fallback. Navigation applies the
current zoom/pan transform without resampling colors, rebuilding Voronoi cells,
or moving points. Off-screen marks are culled using their full radius, and
painter order is retained for overlapping colored shapes. Graphics context loss
is reported inline, with a redraw when the browser restores it.

Local profiling with 40,000 colored hexagons in a 1,000 x 700 logical-pixel
viewport at 2x pixel density measured WebGL2 redraw medians of 2.7 ms at fit,
0.8 ms at 2x zoom, 0.4 ms at 4x, and 0.3 ms at 8x. The fit-view 95th percentile
was 5.3 ms. These measurements include GPU synchronization, but are not a
cross-device frame-rate guarantee. The Canvas 2D fallback remained sharp but
measured about 62 ms at fit in the same local test; dense scenes may run slower
on browsers without WebGL2. Scene preparation is separate from navigation and
can still take longer when generating or changing tens of thousands of marks.

The backing canvas follows viewport size and display pixel density, including
changes between displays. Its dimensions do not grow with preview zoom. Generated
shapes are rasterized afresh at the requested magnification rather than stretching
old pixels; the source photograph still has its original raster-detail limit.
SVG export uses logical canvas dimensions, independent of display density, zoom,
and pan. Culling and viewport bounds have regression tests in
`preview-renderer.test.js`.

## Shapes, orientation, and size

Choose **Dots**, **Squares**, **Triangles**, or **Hexagons** under **Appearance**.
Changing shape or appearance updates existing artwork without regenerating its
point distribution. SVG export uses the exact geometry and colors in the preview.

Polygon shapes support three orientation modes:

- **Same angle for all**: the shared-angle slider rotates every shape by 0-360
  degrees clockwise. At zero, squares are upright, triangles point up, and
  hexagons have a vertex pointing right.
- **Random orientation**: each mark gets a rotation from a separate seeded random
  sequence at generation time. Its rotation stays fixed through refinement,
  appearance changes, and export. The random seed sets the starting rotations.
- **Follow Voronoi pattern**: squares align an edge, triangles point a vertex,
  and hexagons point a vertex along the longest axis of their current Voronoi cell.
  The axis is recalculated as points move during refinement or animation and cached
  for subsequent appearance changes. Symmetric or degenerate cells use a neutral
  axis because they have no unique preferred direction.

Orientation controls are hidden for dots, which look identical at every angle.
**Radius → Min / Variation** apply to every shape: radius means
center-to-edge for dots and center-to-vertex for polygons, in canvas pixels.
Brightness controls the added variation exactly as it does for dots.

## Design system

Components use `--cp-*` tokens rather than independent color or spacing values.
Update the palette in `design-system.css` to restyle both themes, and update its
shared sizing/typography tokens to adjust component density. Native inputs provide
keyboard interaction and validation; custom CSS provides their visual treatment.
Bootstrap and jQuery are not required.

---

## Technologies & Libraries Used

- **HTML5 & CSS** → For UI layout and styling.
- **JavaScript (ES6+)** → Main programming language.
- **Custom token-based CSS components** → Responsive UI and light/dark themes.
- **Canvas API** → Rendering stipple art dynamically.
- **D3.js (d3-delaunay, d3-polygon)** → Voronoi diagram and polygon calculations.
- **Monte Carlo Sampling** → Used for computing weighted centroids.

---

## Usage

Generate and export actions stay in the bottom footer while desktop settings
scroll independently. **Export SVG** and **Export PNG** share one row. PNG exports
the full artwork at logical preview dimensions, independent of zoom and display
density, using the same geometry, colors, and per-mark opacity as SVG.

1. Upload an image.
2. Adjust parameters like stipple count, iteration count, dot size, and colorization.
3. Click **Generate** to create the stipple art.
4. (Optional) Enable **Animate Voronoi** to see the process in real-time.
5. Use **Stop animation** to keep the current pattern.
6. Fine-tune shape, orientation, radius, variation, or original colors on the preview.
7. Download the final result with **Export SVG**.

Generation controls are locked while rendering to prevent overlapping operations.
Uploading a new image resets the artwork and export state. Unsupported or unreadable
images show an inline error. If the image and cutoff cannot yield enough dots,
generation reports an error instead of looping indefinitely; lower the cutoff or
change ink/paper and try again.

## Local development

Open `index.html` in a browser, or serve this directory using an existing static
server, for example `python -m http.server 5173`, then visit
`http://localhost:5173`. D3's drawing libraries require an internet connection.
No package installation is needed.

JavaScript syntax can be checked with:

```sh
node --check studio-ui.js
node --check stipple-art.js
node --check shape-geometry.js
node --check preview-viewport.js
node --check image-import.js
node --check preview-renderer.js
node --check preview-gpu.js
node --check particle-field.js
node --check particle-audio.js
node --test shape-geometry.test.js preview-viewport.test.js preview-renderer.test.js image-import.test.js particle-field.test.js particle-audio.test.js
```

Enjoy creating beautiful stipple art!
