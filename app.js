// Mandelbrot Ultra Deep Zoom (CPU, Web Workers, BigInt-based binary BigFloat)
// - "Really infinite" = you can keep zooming by increasing precision(bits). Auto-precision available.
// - Note: this is CPU-heavy. Use quality(step) > 1 for extremely deep zoom.

const canvas = document.getElementById("c");
const hud = document.getElementById("hud");
const panel = document.getElementById("panel");

const qualitySel = document.getElementById("quality");
const iterInput = document.getElementById("iter");
const precInput = document.getElementById("prec");
const autoPrecSel = document.getElementById("autoPrec");

const btnReset = document.getElementById("reset");
const btnRerender = document.getElementById("rerender");
const btnCopyLink = document.getElementById("copyLink");
const btnTogglePanel = document.getElementById("togglePanel");

const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

let dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
let W = 0, H = 0;

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

// ---------------- BigFloat ----------------
// value = mantissa(BigInt) * 2^exp2, mantissa normalized to ~precBits
class BigFloat {
  constructor(mantissa, exp2, precBits){
    this.m = BigInt(mantissa);
    this.e = exp2 | 0;           // exp base2
    this.p = precBits | 0;
    this._norm();
  }

  static zero(p){ return new BigFloat(0n, 0, p); }

  static fromNumber(x, p){
    if (!Number.isFinite(x) || x === 0) return BigFloat.zero(p);
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    // Decompose x = f * 2^e, with f in [0.5,1)
    let e = Math.floor(Math.log2(x));
    let f = x / (2 ** e);
    if (f < 0.5) { f *= 2; e -= 1; }
    // Convert f to BigInt mantissa with p bits
    const mant = BigInt(Math.floor(f * 2 ** (p - 1))) * BigInt(sign);
    return new BigFloat(mant, e - (p - 1), p);
  }

  // Parse limited decimal like "-0.5" or "1.234e-10"
  static fromDecimalString(str, p){
    str = (str || "").trim();
    if (!str) return BigFloat.zero(p);
    const m = str.match(/^([+-])?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
    if (!m) throw new Error("invalid decimal");
    const sign = m[1] === "-" ? -1n : 1n;
    const intPart = m[2] || "0";
    const fracPart = m[3] || "";
    const exp10 = parseInt(m[4] || "0", 10);

    const digits = intPart + fracPart;
    let n = BigInt(digits || "0");
    let scale10 = fracPart.length - exp10; // n / 10^scale10
    if (scale10 < 0) { n = n * (10n ** BigInt(-scale10)); scale10 = 0; }

    n = n * sign;

    // Convert decimal rational to binary BigFloat approximately with p bits:
    // compute n * 2^k / 10^scale10, choose k large then normalize.
    const k = p + 32; // guard
    let num = n * (1n << BigInt(k));
    let den = 10n ** BigInt(scale10);
    let q = num / den;
    // q represents value * 2^k
    return new BigFloat(q, -k, p);
  }

  clone(){ return new BigFloat(this.m, this.e, this.p); }

  setPrecision(pNew){
    pNew |= 0;
    if (pNew === this.p) return this.clone();
    // convert by keeping same value: just create new and normalize to new p
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
    if (this.m === 0n) return b.clone();
    if (b.m === 0n) return this.clone();
    // align to larger exponent
    let aM = this.m, aE = this.e;
    let bM = b.m, bE = b.e;
    if (aE > bE){
      const s = aE - bE;
      if (s > this.p + 8) return this.clone(); // b too tiny
      bM = bM >> BigInt(s);
      bE += s;
    } else if (bE > aE){
      const s = bE - aE;
      if (s > this.p + 8) return b.clone(); // a too tiny
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
    return new BigFloat(prod, e, this.p); // normalize handles precision
  }

  mulInt(n){
    if (n === 0) return BigFloat.zero(this.p);
    if (this.m === 0n) return BigFloat.zero(this.p);
    return new BigFloat(this.m * BigInt(n), this.e, this.p);
  }

  // approximate log2(|x|) using mantissa bitlen and exponent
  log2AbsApprox(){
    if (this.m === 0n) return -Infinity;
    const bl = this._bitLengthAbs();
    // mantissa normalized to p bits -> top bit around p-1
    // value magnitude ~ 2^(e + (bl-1))
    return this.e + (bl - 1);
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
    // top has ~53 bits
    const val = top * (2 ** e);
    return sign * val;
  }

  toStringShort(){
    // scientific-ish with base10 using approx
    const x = this.toNumberApprox();
    if (x === 0) return "0";
    if (!Number.isFinite(x)) {
      // fallback using log2
      const l2 = this.log2AbsApprox();
      const l10 = l2 / Math.log2(10);
      return `~1e${Math.floor(l10)}`;
    }
    return x.toExponential(6);
  }

  serialize(){
    return { m: this.m.toString(), e: this.e, p: this.p };
  }

  static deserialize(o){
    return new BigFloat(BigInt(o.m), o.e|0, o.p|0);
  }
}

// ---------------- View state ----------------
let precBits = parseInt(precInput.value, 10) || 768;

// Initial view
let centerX = BigFloat.fromDecimalString("-0.5", precBits);
let centerY = BigFloat.fromDecimalString("0.0", precBits);
let scale   = BigFloat.zero(precBits);
let initialScale = null;

function setPrecBits(p){
  p = clamp(p|0, 128, 16384);
  precBits = p;
  precInput.value = String(p);
  centerX = centerX.setPrecision(p);
  centerY = centerY.setPrecision(p);
  scale   = scale.setPrecision(p);
  if (initialScale) initialScale = initialScale.setPrecision(p);
}

function maxIterForScale(){
  // heuristic based on zoom depth
  const depth = (initialScale ? (initialScale.log2AbsApprox() - scale.log2AbsApprox()) : 0);
  // depth grows when scale shrinks
  const base = parseInt(iterInput.value, 10) || 1200;
  const extra = Math.max(0, Math.floor(depth * 20));
  return clamp(base + extra, 100, 200000);
}

function recommendedPrecisionBits(){
  // Need enough bits so that center + pixelOffset remains distinguishable:
  // bits ≈ -log2(scale) + log2(max(W,H)) + margin
  const l2 = -scale.log2AbsApprox();
  const pix = Math.log2(Math.max(1, Math.max(W, H)));
  const bits = Math.ceil(l2 + pix + 64);
  return clamp(bits, 256, 16384);
}

// ---------------- Resize ----------------
function resize(){
  dpr = Math.max(1, Math.min(2.5, window.devicePixelRatio || 1));
  const cssW = Math.floor(window.innerWidth);
  const cssH = Math.floor(window.innerHeight);
  W = Math.max(1, Math.floor(cssW * dpr));
  H = Math.max(1, Math.floor(cssH * dpr));
  canvas.width = W;
  canvas.height = H;

  if (!initialScale){
    const s = 3.5 / W;
    initialScale = BigFloat.fromNumber(s, precBits);
    scale = initialScale.clone();
  }

  requestRender("resize");
}
window.addEventListener("resize", resize, { passive:true });

// ---------------- Worker pool ----------------
const workerCount = Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 8));
const workers = [];
for (let i=0;i<workerCount;i++){
  workers.push(new Worker("./worker.js", { type:"module" }));
}

function clearScreen(){
  ctx.fillStyle = "#0b0b0f";
  ctx.fillRect(0,0,W,H);
}

let renderToken = 0;
let lastRenderT = performance.now();

function updateHUD(reason=""){
  const depth = initialScale ? (initialScale.log2AbsApprox() - scale.log2AbsApprox()) : 0;
  const depth10 = depth / Math.log2(10);
  const iters = maxIterForScale();
  const step = parseInt(qualitySel.value, 10) || 1;
  const ms = (performance.now() - lastRenderT) | 0;

  hud.textContent =
`center = (${centerX.toStringShort()}, ${centerY.toStringShort()})
scale  = ${scale.toStringShort()}
depth  ≈ 2^${depth.toFixed(1)}  (≈ 10^${depth10.toFixed(1)})
iters  = ${iters}
prec   = ${precBits} bits
step   = ${step}
workers= ${workerCount}
last   = ${ms} ms ${reason ? "| "+reason : ""}`;
}

// Progressive render: one pass at chosen step only (speed is precious)
async function requestRender(reason=""){
  const token = ++renderToken;
  lastRenderT = performance.now();
  clearScreen();

  if (autoPrecSel.value === "on"){
    const rec = recommendedPrecisionBits();
    if (rec > precBits){
      setPrecBits(rec);
    }
  }

  const iters = maxIterForScale();
  const step = parseInt(qualitySel.value, 10) || 1;

  const payload = {
    token,
    W, H,
    centerX: centerX.serialize(),
    centerY: centerY.serialize(),
    scale: scale.serialize(),
    maxIter: iters,
    step,
  };

  const strip = Math.max(16, Math.floor(H / (workerCount * 6)));
  const jobs = [];
  for (let y0=0; y0<H; y0 += strip){
    jobs.push({ y0, rows: Math.min(strip, H - y0) });
  }

  let completed = 0;
  const onMessage = (ev) => {
    const msg = ev.data;
    if (!msg || msg.token !== token) return;
    if (msg.type !== "strip") return;

    const { startY, rows, buffer } = msg;
    const data = new Uint8ClampedArray(buffer);
    const img = new ImageData(data, W, rows);
    ctx.putImageData(img, 0, startY);

    completed++;
    if ((completed % 10) === 0 && token === renderToken) updateHUD("rendering...");
    if (completed >= jobs.length){
      for (const wk of workers) wk.removeEventListener("message", onMessage);
      if (token === renderToken) updateHUD(reason);
    }
  };
  for (const wk of workers) wk.addEventListener("message", onMessage);

  for (let i=0;i<jobs.length;i++){
    const wk = workers[i % workerCount];
    wk.postMessage({ ...payload, ...jobs[i] });
  }
}

// debounce helper
let debounce = 0;
function scheduleRender(reason){
  clearTimeout(debounce);
  debounce = setTimeout(()=>requestRender(reason), 70);
}

// ---------------- Interaction ----------------
let dragging = false;
let lastX = 0, lastY = 0;

function toCanvasXY(ev){
  const r = canvas.getBoundingClientRect();
  return { x: (ev.clientX - r.left) * dpr, y: (ev.clientY - r.top) * dpr };
}

canvas.addEventListener("pointerdown", (ev)=>{
  canvas.setPointerCapture(ev.pointerId);
  dragging = true;
  const p = toCanvasXY(ev);
  lastX = p.x; lastY = p.y;
}, { passive:true });

canvas.addEventListener("pointermove", (ev)=>{
  if (!dragging) return;
  const p = toCanvasXY(ev);
  const dx = p.x - lastX;
  const dy = p.y - lastY;
  lastX = p.x; lastY = p.y;

  // center -= dx*scale
  centerX = centerX.sub(scale.mulInt(Math.round(dx)));
  centerY = centerY.sub(scale.mulInt(Math.round(dy)));

  scheduleRender("pan");
}, { passive:true });

canvas.addEventListener("pointerup", ()=>{ dragging=false; }, { passive:true });
canvas.addEventListener("pointercancel", ()=>{ dragging=false; }, { passive:true });

function zoomAt(px, py, factor){
  // Maintain pointer position:
  // newCenter = oldCenter + (p - centerPx)*oldScale - (p - centerPx)*newScale
  const dx = Math.round(px - W*0.5);
  const dy = Math.round(py - H*0.5);

  const oldScale = scale.clone();

  const bf = BigFloat.fromNumber(factor, precBits);
  scale = scale.mul(bf);

  // clamp scale to avoid too huge/too tiny causing UI trouble
  // (you can still go deeper; scale will keep exponent decreasing)
  // we only clamp the factor in interactive steps implicitly.

  const aX = oldScale.mulInt(dx);
  const aY = oldScale.mulInt(dy);
  const bX = scale.mulInt(dx);
  const bY = scale.mulInt(dy);

  centerX = centerX.add(aX.sub(bX));
  centerY = centerY.add(aY.sub(bY));
}

canvas.addEventListener("wheel", (ev)=>{
  ev.preventDefault();
  const { x:px, y:py } = toCanvasXY(ev);

  // exponential zoom factor
  const factor = Math.exp(ev.deltaY * 0.0015);
  zoomAt(px, py, factor);

  scheduleRender("zoom");
}, { passive:false });

canvas.addEventListener("dblclick", (ev)=>{
  const { x:px, y:py } = toCanvasXY(ev);
  const factor = ev.shiftKey ? 2.0 : 0.5;
  zoomAt(px, py, factor);
  requestRender(ev.shiftKey ? "dbl zoom out" : "dbl zoom in");
}, { passive:true });

window.addEventListener("keydown", (ev)=>{
  if (ev.key.toLowerCase() === "r"){
    resetView();
  }
}, { passive:true });

// ---------------- URL state ----------------
function encodeState(){
  const st = {
    cx: centerX.serialize(),
    cy: centerY.serialize(),
    sc: scale.serialize(),
    it: parseInt(iterInput.value,10)||1200,
    stp: parseInt(qualitySel.value,10)||1,
    ap: autoPrecSel.value,
  };
  const json = JSON.stringify(st);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return "#s=" + b64;
}
function decodeState(){
  const h = location.hash || "";
  const m = h.match(/#s=([A-Za-z0-9+/=]+)/);
  if (!m) return false;
  try{
    const json = decodeURIComponent(escape(atob(m[1])));
    const st = JSON.parse(json);
    const p = st?.cx?.p || precBits;
    setPrecBits(p);

    centerX = BigFloat.deserialize(st.cx);
    centerY = BigFloat.deserialize(st.cy);
    scale   = BigFloat.deserialize(st.sc);

    if (st.it) iterInput.value = String(st.it);
    if (st.stp) qualitySel.value = String(st.stp);
    if (st.ap) autoPrecSel.value = st.ap;

    return true;
  }catch{
    return false;
  }
}

function copyLink(){
  const url = location.origin + location.pathname + encodeState();
  navigator.clipboard?.writeText(url).catch(()=>{});
}

// ---------------- UI hooks ----------------
function resetView(){
  setPrecBits(parseInt(precInput.value,10)||768);
  centerX = BigFloat.fromDecimalString("-0.5", precBits);
  centerY = BigFloat.fromDecimalString("0.0", precBits);
  scale = initialScale ? initialScale.setPrecision(precBits) : BigFloat.fromNumber(3.5/Math.max(1,W), precBits);
  requestRender("reset");
}

btnReset.addEventListener("click", resetView);
btnRerender.addEventListener("click", ()=>requestRender("rerender"));
btnCopyLink.addEventListener("click", copyLink);
btnTogglePanel.addEventListener("click", ()=>{
  panel.style.display = (panel.style.display === "none") ? "block" : "none";
});

qualitySel.addEventListener("change", ()=>requestRender("quality"));
iterInput.addEventListener("change", ()=>requestRender("iters"));
precInput.addEventListener("change", ()=>{
  const p = parseInt(precInput.value,10) || 768;
  setPrecBits(p);
  requestRender("precision");
});
autoPrecSel.addEventListener("change", ()=>requestRender("autoPrec"));

if ("serviceWorker" in navigator){
  window.addEventListener("load", async ()=>{
    try{ await navigator.serviceWorker.register("./sw.js"); }catch{}
  });
}

// ---------------- start ----------------
resize();
if (decodeState()){
  requestRender("loaded from link");
} else {
  updateHUD("ready");
  requestRender("start");
}
