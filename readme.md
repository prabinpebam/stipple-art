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
- Includes keyboard focus indicators and reduced-motion support.
- Keeps ink/paper tokens fixed across app themes so changing the interface theme
  does not change the artwork or exported SVG.

### 4. **studio-ui.js**
- Applies the system color scheme before first paint and remembers manual theme
  selection in local storage. If storage is unavailable, the theme still works
  for the current visit and a diagnostic is logged.
- Supports `?scoutTheme=light` or `?scoutTheme=dark` for explicit preview themes.
- Updates slider values and filled tracks, handles the empty-state upload button,
  and displays drag-and-drop feedback.

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

1. Upload an image.
2. Adjust parameters like stipple count, iteration count, dot size, and colorization.
3. Click **Generate** to create the stipple art.
4. (Optional) Enable **Animate Voronoi** to see the process in real-time.
5. Use **Stop animation** to keep the current pattern.
6. Fine-tune dot radius, variation, or original colors directly on the preview.
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
```

Enjoy creating beautiful stipple art!
