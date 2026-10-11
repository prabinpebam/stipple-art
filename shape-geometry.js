(() => {
  const polygons = {
    square: { sides: 4, offset: Math.PI / 4 },
    triangle: { sides: 3, offset: -Math.PI / 2 },
    hexagon: { sides: 6, offset: 0 }
  };

  function polygonVertices(shape, cx, cy, radius, angle) {
    if (!Object.hasOwn(polygons, shape)) throw new Error(`Unsupported polygon shape: ${shape}`);
    const { sides, offset } = polygons[shape];
    return Array.from({ length: sides }, (_, i) => {
      const theta = offset + angle + i * 2 * Math.PI / sides;
      return [cx + radius * Math.cos(theta), cy + radius * Math.sin(theta)];
    });
  }

  function cellOrientation(polygon) {
    if (!polygon || polygon.length < 3) return 0;
    // Area moments yield the cell's major axis, independent of vertex density.
    const [originX, originY] = polygon[0];
    let area2 = 0, sumX = 0, sumY = 0, sumXX = 0, sumYY = 0, sumXY = 0;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      const x1 = a[0] - originX, y1 = a[1] - originY;
      const x2 = b[0] - originX, y2 = b[1] - originY;
      const cross = x1 * y2 - x2 * y1;
      area2 += cross;
      sumX += (x1 + x2) * cross;
      sumY += (y1 + y2) * cross;
      sumXX += (x1 * x1 + x1 * x2 + x2 * x2) * cross;
      sumYY += (y1 * y1 + y1 * y2 + y2 * y2) * cross;
      sumXY += (2 * x1 * y1 + x1 * y2 + x2 * y1 + 2 * x2 * y2) * cross;
    }
    if (Math.abs(area2) < 1e-12) return 0;
    const cx = sumX / (3 * area2), cy = sumY / (3 * area2);
    const xx = sumXX / (6 * area2) - cx * cx;
    const yy = sumYY / (6 * area2) - cy * cy;
    const xy = sumXY / (12 * area2) - cx * cy;
    // Symmetric cells have no preferred direction.
    if (Math.hypot(xx - yy, 2 * xy) < 1e-10 * Math.max(1, Math.abs(xx), Math.abs(yy))) return 0;
    const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
    return (angle + Math.PI) % Math.PI;
  }

  const geometry = { polygonVertices, cellOrientation };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = geometry;
  } else {
    globalThis.StippleGeometry = geometry;
  }
})();
