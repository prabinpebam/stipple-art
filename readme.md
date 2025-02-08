# Stipple Art Generator

## by Prabin Pebam

The **Stipple Art Generator** is an interactive tool that transforms an image into stipple art using a **weighted Voronoi stippling algorithm**. It allows you to control various parameters such as stipple count, iteration count, dot size, and colorization to generate custom stipple patterns.

![Stipple art examples](/images/stipple-art-examples.png "Stipple art examples")
![Stipple art UI](/images/stipple-art-ui.png "Stipple art UI")


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

The project consists of two main files:

### 1. **index.html**
- Defines the UI structure using **Bootstrap 4.5**.
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

---

## Technologies & Libraries Used

- **HTML5 & CSS** → For UI layout and styling.
- **JavaScript (ES6+)** → Main programming language.
- **Bootstrap 4.5** → Responsive UI design.
- **Canvas API** → Rendering stipple art dynamically.
- **D3.js (d3-delaunay, d3-polygon)** → Voronoi diagram and polygon calculations.
- **Monte Carlo Sampling** → Used for computing weighted centroids.

---

## Usage

1. Upload an image.
2. Adjust parameters like stipple count, iteration count, dot size, and colorization.
3. Click **Generate** to create the stipple art.
4. (Optional) Enable **Animate Voronoi** to see the process in real-time.
5. Download the final result as an **SVG** file.

Enjoy creating beautiful stipple art!
