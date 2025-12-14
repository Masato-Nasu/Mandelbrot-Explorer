// UltraDeep Mandelbrot worker (fixed-point BigInt)
function mulFixed(a, b, bits) { return (a * b) >> BigInt(bits); }
function mandelbrotFixed(cx, cy, bits, maxIter) {
  let x = 0n, y = 0n;
  const escape = 4n << BigInt(bits);
  for (let i = 0; i < maxIter; i++) {
    const x2 = mulFixed(x, x, bits);
    const y2 = mulFixed(y, y, bits);
    if (x2 + y2 > escape) return i;

    const xy = mulFixed(x, y, bits);
    const nx = x2 - y2 + cx;
    const ny = (2n * xy) + cy;
    x = nx; y = ny;
  }
  return maxIter;
}
function color(i, maxIter) {
  if (i >= maxIter) return [0,0,0,255];
  const t = i / maxIter;
  const a = 0.5 + 0.5*Math.sin(6.28318*(t*3.0 + 0.00));
  const b = 0.5 + 0.5*Math.sin(6.28318*(t*3.0 + 0.33));
  const c = 0.5 + 0.5*Math.sin(6.28318*(t*3.0 + 0.66));
  return [(a*255)|0,(b*255)|0,(c*255)|0,255];
}
self.onmessage = (ev) => {
  const m = ev.data;
  if (!m || m.type !== "job") return;
  const { token, W, startY, rows, step, maxIter, bits, xmin, ymin, scale } = m;
  const out = new Uint8ClampedArray(W * rows * 4);
  for (let yy = 0; yy < rows; yy += step) {
    const y = startY + yy;
    const cy = ymin + (BigInt(y) * scale);
    for (let xx = 0; xx < W; xx += step) {
      const cx = xmin + (BigInt(xx) * scale);
      const it = mandelbrotFixed(cx, cy, bits, maxIter);
      const [r,g,b,a] = color(it, maxIter);

      const yMax = Math.min(rows, yy + step);
      const xMax = Math.min(W, xx + step);
      for (let by = yy; by < yMax; by++) {
        let idx = (by * W + xx) * 4;
        for (let bx = xx; bx < xMax; bx++) {
          out[idx]=r; out[idx+1]=g; out[idx+2]=b; out[idx+3]=a;
          idx += 4;
        }
      }
    }
  }
  self.postMessage({ type:"strip", token, startY, rows, buffer: out.buffer }, [out.buffer]);
};
