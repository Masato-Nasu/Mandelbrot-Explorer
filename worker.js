/* Mandelbrot fixed-point worker (BigInt)
   value_real = value_fixed / 2^bits
*/
function mulFixed(a, b, bits) {
  return (a * b) >> BigInt(bits);
}
function abs2Fixed(x, y, bits) {
  const x2 = mulFixed(x, x, bits);
  const y2 = mulFixed(y, y, bits);
  return x2 + y2;
}
function clamp01(v){ return v<0?0:(v>1?1:v); }
function color(iter, maxIter){
  if (iter >= maxIter) return [0,0,0,255];
  // cheap palette
  const t = iter / maxIter;
  const a = 0.5 + 0.5*Math.sin(6.28318*(t*3.0 + 0.00));
  const b = 0.5 + 0.5*Math.sin(6.28318*(t*3.0 + 0.33));
  const c = 0.5 + 0.5*Math.sin(6.28318*(t*3.0 + 0.66));
  return [(a*255)|0,(b*255)|0,(c*255)|0,255];
}

function mandelbrotFixed(cx, cy, bits, maxIter){
  let x = 0n, y = 0n;
  const two = 2n;
  const escape = 4n << BigInt(bits);
  let iter = 0;
  for (; iter < maxIter; iter++){
    // x' = x^2 - y^2 + cx
    // y' = 2xy + cy
    const x2 = mulFixed(x, x, bits);
    const y2 = mulFixed(y, y, bits);
    const xy = mulFixed(x, y, bits);

    const nx = x2 - y2 + cx;
    const ny = (two * xy) + cy;
    x = nx; y = ny;

    if (x2 + y2 > escape) break;
  }
  return iter;
}

self.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg || msg.type !== "job") return;

  const { token, W, startY, rows, step, maxIter, bits, xmin, ymin, scale } = msg;

  const out = new Uint8ClampedArray(W * rows * 4);
  const bitsN = bits|0;

  // Fill by blocks (step)
  for (let yy = 0; yy < rows; yy += step) {
    const y = startY + yy;
    const cy = ymin + (BigInt(y) * scale);

    for (let xx = 0; xx < W; xx += step) {
      const cx = xmin + (BigInt(xx) * scale);

      const it = mandelbrotFixed(cx, cy, bitsN, maxIter);
      const [r,g,b,a] = color(it, maxIter);

      const yMax = Math.min(rows, yy + step);
      const xMax = Math.min(W, xx + step);

      for (let by = yy; by < yMax; by++) {
        let idx = (by * W + xx) * 4;
        for (let bx = xx; bx < xMax; bx++) {
          out[idx] = r; out[idx+1]=g; out[idx+2]=b; out[idx+3]=a;
          idx += 4;
        }
      }
    }
  }

  self.postMessage({ type:"strip", token, startY, rows, buffer: out.buffer }, [out.buffer]);
};
