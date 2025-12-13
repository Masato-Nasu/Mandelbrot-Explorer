// worker.js - Mandelbrot compute using BigInt-based BigFloat (binary floating).
// This is deliberately "true deep" rather than GPU-fast.

function clamp01(v){ return v < 0 ? 0 : (v > 1 ? 1 : v); }

// Smooth palette
function colorFromMu(mu){
  const t = mu * 0.035;
  const r = 0.55 + 0.45 * Math.sin(t + 0.0);
  const g = 0.55 + 0.45 * Math.sin(t + 2.094);
  const b = 0.55 + 0.45 * Math.sin(t + 4.188);
  return [
    (clamp01(r) * 255) | 0,
    (clamp01(g) * 255) | 0,
    (clamp01(b) * 255) | 0
  ];
}

class BigFloat {
  constructor(m, e, p){
    this.m = BigInt(m);
    this.e = e|0;
    this.p = p|0;
    this._norm();
  }
  static zero(p){ return new BigFloat(0n, 0, p); }

  static fromNumber(x, p){
    if (!Number.isFinite(x) || x === 0) return BigFloat.zero(p);
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    let e = Math.floor(Math.log2(x));
    let f = x / (2 ** e);
    if (f < 0.5) { f *= 2; e -= 1; }
    const mant = BigInt(Math.floor(f * 2 ** (p - 1))) * BigInt(sign);
    return new BigFloat(mant, e - (p - 1), p);
  }

  static deserialize(o){
    return new BigFloat(BigInt(o.m), o.e|0, o.p|0);
  }

  setPrecision(pNew){
    pNew |= 0;
    if (pNew === this.p) return new BigFloat(this.m, this.e, this.p);
    return new BigFloat(this.m, this.e, pNew);
  }

  _bitLengthAbs(){
    let a = this.m < 0n ? -this.m : this.m;
    if (a === 0n) return 0;
    return a.toString(2).length;
  }

  _norm(){
    if (this.m === 0n){ this.e = 0; return; }
    const sign = this.m < 0n ? -1n : 1n;
    let a = this.m < 0n ? -this.m : this.m;
    let bl = a.toString(2).length;
    const target = this.p;
    if (bl > target){
      const shift = bl - target;
      a = a >> BigInt(shift);
      this.e += shift;
    } else if (bl < target){
      const shift = target - bl;
      a = a << BigInt(shift);
      this.e -= shift;
    }
    this.m = a * sign;
  }

  add(b){
    b = (b.p === this.p) ? b : b.setPrecision(this.p);
    if (this.m === 0n) return new BigFloat(b.m, b.e, this.p);
    if (b.m === 0n) return new BigFloat(this.m, this.e, this.p);

    let aM = this.m, aE = this.e;
    let bM = b.m, bE = b.e;

    if (aE > bE){
      const s = aE - bE;
      if (s > this.p + 8) return new BigFloat(this.m, this.e, this.p);
      bM = bM >> BigInt(s);
      bE += s;
    } else if (bE > aE){
      const s = bE - aE;
      if (s > this.p + 8) return new BigFloat(b.m, b.e, this.p);
      aM = aM >> BigInt(s);
      aE += s;
    }
    return new BigFloat(aM + bM, aE, this.p);
  }

  sub(b){ return this.add(b.neg()); }
  neg(){ return new BigFloat(-this.m, this.e, this.p); }

  mul(b){
    b = (b.p === this.p) ? b : b.setPrecision(this.p);
    if (this.m === 0n || b.m === 0n) return BigFloat.zero(this.p);
    const prod = this.m * b.m;
    const e = this.e + b.e;
    return new BigFloat(prod, e, this.p);
  }

  mulInt(n){
    if (n === 0 || this.m === 0n) return BigFloat.zero(this.p);
    return new BigFloat(this.m * BigInt(n), this.e, this.p);
  }

  toNumberApprox(){
    if (this.m === 0n) return 0;
    const sign = this.m < 0n ? -1 : 1;
    let a = this.m < 0n ? -this.m : this.m;
    const bl = a.toString(2).length;
    const take = 53;
    let shift = bl - take;
    if (shift < 0) shift = 0;
    const top = Number(a >> BigInt(shift));
    const e = this.e + shift;
    const val = top * (2 ** e);
    return sign * val;
  }
}

function mandelbrot(cRe, cIm, maxIter){
  let zRe = BigFloat.zero(cRe.p);
  let zIm = BigFloat.zero(cRe.p);

  // approximate magnitude for smooth coloring
  let reN = 0, imN = 0;

  for (let i=0; i<maxIter; i++){
    // z^2 + c
    const re2 = zRe.mul(zRe);
    const im2 = zIm.mul(zIm);
    const reim = zRe.mul(zIm).mulInt(2);

    zRe = re2.sub(im2).add(cRe);
    zIm = reim.add(cIm);

    // Escape check using approx double (safe because |z| usually around small numbers near escape)
    reN = zRe.toNumberApprox();
    imN = zIm.toNumberApprox();
    const r2 = reN*reN + imN*imN;
    if (r2 > 4){
      // smooth iteration
      const mag = Math.sqrt(r2);
      const mu = i + 1 - Math.log2(Math.log2(Math.max(1e-30, mag)));
      return { inside:false, mu };
    }
  }
  return { inside:true, mu:maxIter };
}

self.onmessage = (ev)=>{
  const msg = ev.data;
  if (!msg) return;

  const { token, W, H, centerX, centerY, scale, maxIter, startY, rows, step } = msg;

  const cx = BigFloat.deserialize(centerX);
  const cy = BigFloat.deserialize(centerY);
  const sc = BigFloat.deserialize(scale);

  const out = new Uint8ClampedArray(W * rows * 4);

  const halfW = Math.floor(W/2);
  const halfH = Math.floor(H/2);

  for (let yy=0; yy<rows; yy += step){
    const y = startY + yy;
    const dy = y - halfH;
    const cIm = cy.add(sc.mulInt(dy));

    for (let xx=0; xx<W; xx += step){
      const dx = xx - halfW;
      const cRe = cx.add(sc.mulInt(dx));

      const m = mandelbrot(cRe, cIm, maxIter);

      let r=0,g=0,b=0;
      if (!m.inside){
        [r,g,b] = colorFromMu(m.mu);
      }

      const yMax = Math.min(rows, yy + step);
      const xMax = Math.min(W, xx + step);

      for (let by=yy; by<yMax; by++){
        const rowOff = (by * W) * 4;
        for (let bx=xx; bx<xMax; bx++){
          const i = rowOff + bx * 4;
          out[i+0]=r; out[i+1]=g; out[i+2]=b; out[i+3]=255;
        }
      }
    }
  }

  self.postMessage({
    type:"strip",
    token,
    startY,
    rows,
    buffer: out.buffer
  }, [out.buffer]);
};
