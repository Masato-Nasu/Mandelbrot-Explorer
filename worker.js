/* classic worker - fixed-point BigInt Mandelbrot */
function mulFP(a, b, bits){
  return (a * b) >> bits;
}

function palette(iter, maxIter){
  if (iter >= maxIter) return [0,0,0];
  const t = (iter * 13) & 1023;
  const r = (t * 5) & 255;
  const g = (t * 9) & 255;
  const b = (t * 13) & 255;
  return [r,g,b];
}

function mandelbrotFixed(cx, cy, maxIter, bits){
  let x = 0n, y = 0n;
  let iter = 0;
  const four = 4n << bits;

  while (iter < maxIter){
    const x2 = mulFP(x, x, bits);
    const y2 = mulFP(y, y, bits);
    if (x2 + y2 > four) break;
    const twoXY = (mulFP(x, y, bits) << 1n);
    y = twoXY + cy;
    x = (x2 - y2) + cx;
    iter++;
  }
  return iter;
}

self.onmessage = (ev) => {
  const msg = ev.data;
  try{
    if (!msg || msg.type !== "job") return;

    const token = msg.token;
    const W = msg.W|0;
    const startY = msg.startY|0;
    const rows = msg.rows|0;
    const step = Math.max(1, msg.step|0);
    const maxIter = msg.maxIter|0;

    // accept both new and legacy key names (cache-mismatch safety)
    const bits = BigInt((msg.bits ?? msg.b ?? 512) | 0);
    const xmin = (msg.xmin ?? msg.x0);
    const ymin = (msg.ymin ?? msg.y0);
    const scale = (msg.scale ?? msg.s);

    if (typeof xmin !== "bigint" || typeof ymin !== "bigint" || typeof scale !== "bigint"){
      throw new Error("Bad job payload: expected BigInt xmin/ymin/scale. (Cache mismatch?)");
    }

    const out = new Uint8ClampedArray(W * rows * 4);

    for (let yy = 0; yy < rows; yy += step){
      const y = startY + yy;
      const cy = ymin + BigInt(y) * scale;

      for (let xx = 0; xx < W; xx += step){
        const cx = xmin + BigInt(xx) * scale;
        const iter = mandelbrotFixed(cx, cy, maxIter, bits);
        const [r,g,b] = palette(iter, maxIter);

        const yMax = Math.min(rows, yy + step);
        const xMax = Math.min(W, xx + step);
        for (let by = yy; by < yMax; by++){
          const rowOff = (by * W) * 4;
          for (let bx = xx; bx < xMax; bx++){
            const i = rowOff + bx * 4;
            out[i+0]=r; out[i+1]=g; out[i+2]=b; out[i+3]=255;
          }
        }
      }
    }

    self.postMessage({ type:"strip", token, startY, rows, buffer: out.buffer }, [out.buffer]);
  }catch(e){
    self.postMessage({ type:"error", token: (msg && msg.token) || 0, message: String(e && e.stack ? e.stack : e) });
  }
};
