/* classic worker - fixed-point BigInt Mandelbrot */
function mulFP(a, b, bits){
  return (a * b) >> bits;
}

function fixedToNumber(x, bits){
  // x is fixed-point BigInt (scaled by 2^bits). Assumes |value| is within a few units (e.g., [-3,3]).
  let neg = false;
  if (x < 0n){ neg = true; x = -x; }
  const intBI = x >> bits;
  const intN = Number(intBI); // should be small
  const rem = x - (intBI << bits);

  let frac = 0;
  if (bits <= 52n){
    const denom = 2 ** Number(bits);
    frac = Number(rem) / denom;
  }else{
    const sh = bits - 52n;
    const top = rem >> sh;
    frac = Number(top) / (2 ** 52);
  }
  const v = intN + frac;
  return neg ? -v : v;
}

function isInsideQuick(cx, cy, bits){
  // cardioid / period-2 bulb test (double precision)
  const x = fixedToNumber(cx, bits);
  const y = fixedToNumber(cy, bits);

  // Period-2 bulb: (x+1)^2 + y^2 <= 1/16
  const x1 = x + 1.0;
  if (x1*x1 + y*y <= 0.0625) return true;

  // Main cardioid:
  const xq = x - 0.25;
  const q = xq*xq + y*y;
  if (q * (q + xq) <= 0.25 * y*y) return true;

  return false;
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
