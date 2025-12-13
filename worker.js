/* classic worker (no module) */

function clamp01(v){ return v < 0 ? 0 : (v > 1 ? 1 : v); }

function palette(iter, maxIter){
  if (iter >= maxIter) return [0,0,0];
  // simple smooth-ish palette using sine with iter only (works for fixed too)
  const t = iter * 0.06;
  const r = 0.55 + 0.45 * Math.sin(t + 0.0);
  const g = 0.55 + 0.45 * Math.sin(t + 2.094);
  const b = 0.55 + 0.45 * Math.sin(t + 4.188);
  return [(clamp01(r)*255)|0, (clamp01(g)*255)|0, (clamp01(b)*255)|0];
}

function mandelbrotDouble(cx, cy, maxIter){
  let x=0, y=0, x2=0, y2=0, iter=0;
  while ((x2+y2) <= 4 && iter < maxIter){
    y = 2*x*y + cy;
    x = x2 - y2 + cx;
    x2 = x*x; y2 = y*y;
    iter++;
  }
  return iter;
}

// Fixed-point helpers
function mulFP(a, b, bits){
  // (a*b) >> bits
  return (a * b) >> bits;
}

function mandelbrotFixed(cx, cy, maxIter, bits){
  let x = 0n, y = 0n;
  let iter = 0;
  const four = 4n << BigInt(bits);

  while (iter < maxIter){
    const x2 = mulFP(x, x, BigInt(bits));
    const y2 = mulFP(y, y, BigInt(bits));
    if (x2 + y2 > four) break;

    const twoXY = (mulFP(x, y, BigInt(bits)) << 1n);
    y = twoXY + cy;
    x = (x2 - y2) + cx;
    iter++;
  }
  return iter;
}

self.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg || msg.type !== "job") return;

  try {
    const { token, W, H, startY, rows, step, maxIter, mode } = msg;
    const out = new Uint8ClampedArray(W * rows * 4);

    if (mode === "double") {
      const xmin = msg.xmin;
      const ymin = msg.ymin;
      const scale = msg.scale;

      for (let yy=0; yy<rows; yy+=step){
        const y = startY + yy;
        const cy = ymin + y * scale;

        for (let xx=0; xx<W; xx+=step){
          const cx = xmin + xx * scale;
          const iter = mandelbrotDouble(cx, cy, maxIter);
          const [r,g,b] = palette(iter, maxIter);

          const yMax = Math.min(rows, yy + step);
          const xMax = Math.min(W, xx + step);
          for (let by=yy; by<yMax; by++){
            const rowOff = (by * W) * 4;
            for (let bx=xx; bx<xMax; bx++){
              const i = rowOff + bx*4;
              out[i]=r; out[i+1]=g; out[i+2]=b; out[i+3]=255;
            }
          }
        }
      }
    } else {
      const bits = msg.bits|0;
      const Bits = BigInt(bits);
      const xminfp = BigInt(msg.xminfp);
      const yminfp = BigInt(msg.yminfp);
      const scalefp = BigInt(msg.scalefp);

      for (let yy=0; yy<rows; yy+=step){
        const y = BigInt(startY + yy);
        const cy = yminfp + y * scalefp;

        for (let xx=0; xx<W; xx+=step){
          const x = BigInt(xx);
          const cx = xminfp + x * scalefp;

          const iter = mandelbrotFixed(cx, cy, maxIter, bits);
          const [r,g,b] = palette(iter, maxIter);

          const yMax = Math.min(rows, yy + step);
          const xMax = Math.min(W, xx + step);
          for (let by=yy; by<yMax; by++){
            const rowOff = (by * W) * 4;
            for (let bx=xx; bx<xMax; bx++){
              const i = rowOff + bx*4;
              out[i]=r; out[i+1]=g; out[i+2]=b; out[i+3]=255;
            }
          }
        }
      }
    }

    self.postMessage({ type:"strip", token, startY, rows, buffer: out.buffer }, [out.buffer]);
  } catch (e) {
    self.postMessage({ type:"error", token: msg.token, message: String(e && e.stack ? e.stack : e) });
  }
};
