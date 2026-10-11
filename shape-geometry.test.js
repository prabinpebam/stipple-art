const test = require('node:test');
const assert = require('node:assert/strict');
const { polygonVertices, cellOrientation } = require('./shape-geometry.js');

function near(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} is not close to ${expected}`);
}

function rectangle(angle = 0, cx = 0, cy = 0) {
  return [[-6, -1], [6, -1], [6, 1], [-6, 1]].map(([x, y]) => [
    cx + x * Math.cos(angle) - y * Math.sin(angle),
    cy + x * Math.sin(angle) + y * Math.cos(angle)
  ]);
}

for (const [shape, sides] of [['square', 4], ['triangle', 3], ['hexagon', 6]]) {
  test(`${shape} has ${sides} regular vertices at the requested radius`, () => {
    const vertices = polygonVertices(shape, 123, 456, 8, Math.PI / 6);
    assert.equal(vertices.length, sides);
    vertices.forEach(([x, y]) => near(Math.hypot(x - 123, y - 456), 8));
    near(vertices.reduce((sum, vertex) => sum + vertex[0], 0) / sides, 123);
    near(vertices.reduce((sum, vertex) => sum + vertex[1], 0) / sides, 456);
    const edgeLengths = vertices.map(([x, y], i) => {
      const next = vertices[(i + 1) % sides];
      return Math.hypot(x - next[0], y - next[1]);
    });
    edgeLengths.forEach(length => near(length, edgeLengths[0]));
  });

  test(`${shape} applies the same rotation at every location and size`, () => {
    const base = polygonVertices(shape, 0, 0, 1, 0);
    const angle = 73 * Math.PI / 180;
    const rotated = polygonVertices(shape, 25, 60, 4, angle);
    base.forEach(([x, y], i) => {
      near(rotated[i][0], 25 + 4 * (x * Math.cos(angle) - y * Math.sin(angle)));
      near(rotated[i][1], 60 + 4 * (x * Math.sin(angle) + y * Math.cos(angle)));
    });
    const fullTurn = polygonVertices(shape, 0, 0, 1, 2 * Math.PI);
    fullTurn.forEach(([x, y], i) => {
      near(x, base[i][0]);
      near(y, base[i][1]);
    });
  });
}

test('neutral shapes have upright square edges, an upward triangle, and a rightward hexagon vertex', () => {
  const square = polygonVertices('square', 0, 0, 1, 0);
  near(square[0][1], square[1][1]);
  const triangle = polygonVertices('triangle', 0, 0, 1, 0);
  near(triangle[0][0], 0);
  near(triangle[0][1], -1);
  const hexagon = polygonVertices('hexagon', 0, 0, 1, 0);
  near(hexagon[0][0], 1);
  near(hexagon[0][1], 0);
});

test('unsupported polygons report an error', () => {
  assert.throws(() => polygonVertices('dot', 0, 0, 1, 0), /Unsupported polygon/);
  assert.throws(() => polygonVertices('toString', 0, 0, 1, 0), /Unsupported polygon/);
});

test('Voronoi alignment follows horizontal, vertical, and rotated major axes', () => {
  for (const angle of [0, Math.PI / 6, Math.PI / 2, 2 * Math.PI / 3, 5 * Math.PI / 6]) {
    near(cellOrientation(rectangle(angle)), angle);
  }
});

test('alignment is invariant to winding, closed paths, and translation', () => {
  const angle = Math.PI / 3;
  const polygon = rectangle(angle, 1000000, 2000000);
  near(cellOrientation(polygon), angle, 1e-7);
  near(cellOrientation([...polygon].reverse()), angle, 1e-7);
  near(cellOrientation([...polygon, polygon[0]]), angle, 1e-7);
});

test('extra collinear vertices do not bias the cell axis', () => {
  const polygon = [[-6, -1], [-5, -1], [-4, -1], [-3, -1], [6, -1], [6, 1], [-6, 1]];
  near(cellOrientation(polygon), 0);
});

test('symmetric, missing, and degenerate cells use a neutral orientation', () => {
  near(cellOrientation(polygonVertices('square', 10, 20, 5, Math.PI / 6)), 0);
  near(cellOrientation(polygonVertices('hexagon', 10, 20, 5, Math.PI / 6)), 0);
  near(cellOrientation(null), 0);
  near(cellOrientation([]), 0);
  near(cellOrientation([[0, 0], [1, 0], [2, 0]]), 0);
});
