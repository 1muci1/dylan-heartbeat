"use strict";

((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CompanionDrawingProtocol = api;
})(typeof globalThis === "object" ? globalThis : this, () => {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

  function svgEscape(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function normalizeStrokes(strokes, canvas = {}) {
    const width = clamp(canvas.width || 600, 1, 2000);
    const height = clamp(canvas.height || 420, 1, 2000);
    return (Array.isArray(strokes) ? strokes : []).slice(0, 500).map(stroke => ({
      tool: "polyline",
      color: /^#[0-9a-f]{3,8}$/i.test(stroke?.color || "") ? stroke.color : "#51475a",
      width: clamp(stroke?.width || 5, 1, 40),
      points: (Array.isArray(stroke?.points) ? stroke.points : []).slice(0, 5000)
        .map(point => [clamp(point?.[0], 0, width), clamp(point?.[1], 0, height)])
    })).filter(stroke => stroke.points.length > 0);
  }

  function strokesToSvg(strokes, canvas = {}) {
    const width = clamp(canvas.width || 600, 1, 2000);
    const height = clamp(canvas.height || 420, 1, 2000);
    const paths = normalizeStrokes(strokes, { width, height }).map(stroke => {
      const points = stroke.points.map(point => point.map(value => Math.round(value * 10) / 10).join(",")).join(" ");
      return `<polyline points="${svgEscape(points)}" fill="none" stroke="${svgEscape(stroke.color)}" stroke-width="${stroke.width}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="画作"><rect width="100%" height="100%" fill="#fff"/>${paths}</svg>`;
  }

  function makeAsciiGrid(strokes, canvas = {}, columns = 60, rows = 42) {
    const width = clamp(canvas.width || 600, 1, 2000);
    const height = clamp(canvas.height || 420, 1, 2000);
    const grid = Array.from({ length: rows }, () => Array(columns).fill(" "));
    for (const stroke of normalizeStrokes(strokes, { width, height })) {
      for (let index = 1; index < stroke.points.length; index++) {
        const [x0, y0] = stroke.points[index - 1];
        const [x1, y1] = stroke.points[index];
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 3));
        for (let step = 0; step <= steps; step++) {
          const x = x0 + (x1 - x0) * step / steps;
          const y = y0 + (y1 - y0) * step / steps;
          const column = Math.min(columns - 1, Math.floor(x / width * columns));
          const row = Math.min(rows - 1, Math.floor(y / height * rows));
          grid[row][column] = "█";
        }
      }
    }
    return grid.map(row => row.join("")).join("\n");
  }

  return Object.freeze({ svgEscape, normalizeStrokes, strokesToSvg, makeAsciiGrid });
});
