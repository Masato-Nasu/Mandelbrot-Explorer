// Mandelbrot Explorer UltraDeep v7 (stable rewrite)
(() => {
  const $ = (id) => document.getElementById(id);

  const canvas = $("c");
  const hud = $("hud");
  const errBox = $("errBox");

  const modeEl = $("mode");
  const resEl = $("res");
  const stepEl = $("step");
  const iterEl = $("iterCap");
  const bitsEl = $("bits");
  const autoBitsEl = $("autoBits");
  const previewEl = $("preview");
  const autoSettleEl = $("autoSettle");
  const hqBtn = $("hqBtn");
  const saveBtn = $("saveBtn");
  const resetBtn = $("resetBtn");
  const nukeBtn = $("nukeBtn");

  function showErr(t){
    errBox.style.display = "block";
    errBox.textContent = t;
  }

  // If any runtime error escapes, show it.
  window.addEventListener("error", (e) => showErr("[window.error]\n" + e.message + "\n" + e.filename + ":" + e.lineno + ":" + e.colno));
  window.addEventListener("unhandledrejection", (e) => showErr("[unhandledrejection]\n" + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));

  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  let dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  let cssW = 0, cssH = 0;
  let W = 0, H = 0;

  // view parameters (center in float64 for UI; also fixed-point for UltraDeep)
  let centerX = -0.5;
  let centerY = 0.0;
  let initialScale = 0;      // float64 (complex per pixel)
  let scaleF = 0;            // float64

  // UltraDeep fixed-point helpers (BigInt)
// Number -> fixed-point BigInt with arbitrary bits using IEEE-754 decomposition.
// This avoids Math.pow(2,bits) overflow when bits > ~1023.
function f2fixed(n, bits){
    if (!Number.isFinite(n)) throw new RangeError("f2fixed: non-finite");
    bits = bits|0;
    if (n === 0) return 0n;

    const buf = new ArrayBuffer(8);
    const dv = new DataView(buf);
    dv.setFloat64(0, n, false);

    const hi = dv.getUint32(0, false);
    const lo = dv.getUint32(4, false);

    const sign = (hi >>> 31) ? -1n : 1n;
    const exp = (hi >>> 20) & 0x7ff;
    const fracHi = hi & 0xFFFFF;

    let mant = (BigInt(fracHi) << 32n) | BigInt(lo); // 52-bit fraction (no hidden bit yet)
    let e2;
    if (exp === 0) {
      // subnormal: value = mant * 2^-1074
      e2 = -1074;
    } else {
      // normal: value = (2^52 + mant) * 2^(exp-1023-52)
      mant = (1n << 52n) | mant;
      e2 = (exp - 1023 - 52);
    }

    let shift = e2 + bits; // fixed = mant * 2^(e2+bits)
    let out;
    if (shift >= 0) {
      out = mant << BigInt(shift);
    } else {
      const rshift = BigInt(-shift);
      // round-to-nearest: add 0.5 ulp before shifting
      const half = 1n << (rshift - 1n);
      out = (mant + half) >> rshift;
    }
    return sign * out;
  }

// fixed-point BigInt -> Number (only safe for moderate bits; used for debug only)
function fixed2f(v, bits){
    bits = bits|0;
    if (bits > 1023) {
      // Avoid Infinity; best-effort downshift for debug
      const sh = bits - 1023;
      v = v >> BigInt(sh);
      bits = 1023;
    }
    return Number(v) / Math.pow(2, bits);
  }

  // Workers
  const workerCount = Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 8));
  const workers = [];
  let workerOK = true;
  try{
    for (let i = 0; i < workerCount; i++) {
      const w = new Worker("./worker.js?v=v7_" + Date.now().toString(36));
      w.onerror = (e)=>{ workerOK = false; showErr("[Worker error]\n" + (e.message||"worker failed")); };
      workers.push(w);
    }
  }catch(e){
    workerOK = false;
    showErr("[Worker init failed]\n" + (e.stack || e.message || e));
  }

  function resize(force=false){
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    cssW = Math.max(1, Math.floor(window.innerWidth));
    cssH = Math.max(1, Math.floor(window.innerHeight));
    const r = parseFloat(resEl?.value || "0.70");
    const internal = Math.max(0.30, Math.min(1.0, r));
    const targetW = Math.max(1, Math.floor(cssW * dpr * internal));
    const targetH = Math.max(1, Math.floor(cssH * dpr * internal));
    if (!force && targetW === W && targetH === H) return;
    W = targetW; H = targetH;
    canvas.width = W; canvas.height = H;
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";

    if (!initialScale) {
      initialScale = 3.5 / W;
      scaleF = initialScale;
    }
  }
  window.addEventListener("resize", () => { resize(true); requestRender("resize"); }, { passive:true });

  // Iteration heuristic
  function itersForScale(scale){
    const mag = initialScale / scale;
    const base = 240 + Math.floor(70 * Math.log(Math.max(1, mag)));
    const cap = Math.max(150, Math.min(30000, parseInt(iterEl?.value || "1400", 10)));
    return Math.max(150, Math.min(cap, base));
  }

  // Interaction
  let isDragging = false;
  let lastX = 0, lastY = 0;
  let renderToken = 0;
  let debounce = 0;
  let settleTimer = 0;

  function canvasXY(ev){
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (W / rect.width);
    const y = (ev.clientY - rect.top) * (H / rect.height);
    return {x,y};
  }
  function pixelToComplex(px, py){
    return {
      x: centerX + (px - W*0.5) * scaleF,
      y: centerY + (py - H*0.5) * scaleF
    };
  }

  function schedule(reason){
    clearTimeout(debounce);
    debounce = setTimeout(() => requestRender(reason, { preview:true }), 35);
    if (autoSettleEl?.checked) {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => requestRender("settle", { preview:false }), 220);
    }
  }

  canvas.addEventListener("pointerdown", (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    isDragging = true;
    const p = canvasXY(ev);
    lastX = p.x; lastY = p.y;
  }, { passive:true });

  canvas.addEventListener("pointermove", (ev) => {
    if (!isDragging) return;
    const p = canvasXY(ev);
    const dx = p.x - lastX;
    const dy = p.y - lastY;
    lastX = p.x; lastY = p.y;
    centerX -= dx * scaleF;
    centerY -= dy * scaleF;
    schedule("pan");
  }, { passive:true });

  canvas.addEventListener("pointerup", () => { isDragging=false; }, { passive:true });
  canvas.addEventListener("pointercancel", () => { isDragging=false; }, { passive:true });

  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const {x:px, y:py} = canvasXY(ev);
    const before = pixelToComplex(px, py);

    const base = 0.0080;
    const fine = ev.shiftKey ? 0.25 : 1.0;
    const turbo = ev.altKey ? 4.0 : 1.0;
    const hyper = ev.ctrlKey ? 12.0 : 1.0;
    const dyN = ev.deltaY * (ev.deltaMode === 1 ? 16 : 1);
    const speed = base * fine * turbo * hyper;
    const factor = Math.exp(-dyN * speed);

    // clamp scale
    scaleF = Math.max(1e-300, Math.min(10, scaleF * factor));

    const after = pixelToComplex(px, py);
    centerX += (before.x - after.x);
    centerY += (before.y - after.y);
    schedule("zoom");
  }, { passive:false });

  window.addEventListener("keydown", (ev) => {
    if (ev.key.toLowerCase() === "r") doReset();
    if (ev.key.toLowerCase() === "s") savePNG();
  }, { passive:true });

  function doReset(){
    centerX = -0.5; centerY = 0.0;
    scaleF = initialScale || (3.5 / Math.max(1, W));
    requestRender("reset", { preview:false });
  }

  async function savePNG(){
    try{
      const mode = (modeEl?.value || "ultradeep");
      const bits = (bitsEl?.value || "").trim();
      const iters = (iterEl?.value || "").trim();
      const step = (stepEl?.value || "").trim();
      const res = (resEl?.value || "").trim();
      const stamp = new Date().toISOString().replace(/[:.]/g,"-");
      const name = `mandelbrot_${mode}_bits${bits}_it${iters}_step${step}_res${res}_${stamp}.png`;

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("toBlob failed");

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 4000);
    }catch(e){
      showErr("[savePNG]\n" + ((e && (e.stack || e.message)) || e));
    }
  }

  resetBtn?.addEventListener("click", doReset);
  nukeBtn?.addEventListener("click", () => { location.href = "./reset.html"; });

  saveBtn?.addEventListener("click", () => { savePNG(); });


  hqBtn?.addEventListener("click", () => {
    // 段階的に高精細化：まず軽く出してから step を下げていく（最終的に step=1）
    // 内部解像度は 1.0 に固定して作品品質を狙う
    if (resEl) resEl.value = "1.00";
    resize(true);

    const passes = [6, 3, 2, 1];
    const delays = [0, 220, 520, 900]; // ms

    for (let i = 0; i < passes.length; i++) {
      const st = passes[i];
      setTimeout(() => {
        if (stepEl) stepEl.value = String(st);
        requestRender("HQ pass step=" + st, { preview: false, forceStep: st });
      }, delays[i]);
    }
  });
  // Rendering
  function clear(){
    ctx.fillStyle = "#0b0b0f";
    ctx.fillRect(0,0,W,H);
  }

  function updateHUD(reason, ms, iters, bitsUsed, step, internal){
    const mag = initialScale / scaleF;
    hud.textContent =
`center = (${centerX.toPrecision(16)}, ${centerY.toPrecision(16)})
scale  = ${scaleF.toExponential(6)} (magnification ≈ ${mag.toExponential(3)}x)
mode   = ${modeEl?.value || "ultradeep"}   workers=${workerCount} (ok=${workerOK})
iters  = ${iters}   bits=${bitsUsed}   step=${step}   internalRes=${internal}
last   = ${ms|0} ms   ${reason||""}`;
  }

  function renderStandard(token, opts){
    const start = performance.now();
    const internal = parseFloat(resEl?.value || "0.70");
    const preview = !!(opts && opts.preview) && (previewEl?.checked ?? true);
    const baseStep = parseInt(stepEl?.value || "2", 10);
    let step = ((opts && opts.hq) ? 1 : (preview ? Math.min(16, Math.max(6, baseStep*3)) : baseStep));
    if (opts && Number.isFinite(opts.forceStep)) step = Math.max(1, opts.forceStep|0);
    const iters = itersForScale(scaleF);

    const img = ctx.createImageData(W, H);
    const data = img.data;
    const xmin = centerX - (W*0.5)*scaleF;
    const ymin = centerY - (H*0.5)*scaleF;

    function mandel(cx, cy){
      let x=0, y=0, x2=0, y2=0;
      let i=0;
      while (i<iters && x2+y2<=4){
        y = 2*x*y + cy;
        x = x2 - y2 + cx;
        x2 = x*x; y2=y*y;
        i++;
      }
      return i;
    }
    function color(i){
      if (i>=iters) return [0,0,0,255];
      const t = i/iters;
      const a = 0.5+0.5*Math.sin(6.28318*(t*3.0 + 0.00));
      const b = 0.5+0.5*Math.sin(6.28318*(t*3.0 + 0.33));
      const c = 0.5+0.5*Math.sin(6.28318*(t*3.0 + 0.66));
      return [(a*255)|0,(b*255)|0,(c*255)|0,255];
    }

    for (let y=0; y<H; y+=step){
      const cy = ymin + y*scaleF;
      for (let x=0; x<W; x+=step){
        const cx = xmin + x*scaleF;
        const it = mandel(cx, cy);
        const [r,g,b,a] = color(it);
        const yMax = Math.min(H, y+step);
        const xMax = Math.min(W, x+step);
        for (let yy=y; yy<yMax; yy++){
          let idx = (yy*W + x)*4;
          for (let xx=x; xx<xMax; xx++){
            data[idx]=r; data[idx+1]=g; data[idx+2]=b; data[idx+3]=a;
            idx+=4;
          }
        }
      }
    }
    if (token !== renderToken) return;
    ctx.putImageData(img, 0, 0);
    updateHUD("standard "+(opts?.preview?"preview":"full"), performance.now()-start, iters, 0, step, internal.toFixed(2));
  }

  function renderUltraDeep(token, opts){
    const start = performance.now();
    const preview = !!(opts && opts.preview) && (previewEl?.checked ?? true);
    const baseBits = parseInt(bitsEl?.value || "512", 10) | 0;
    const iters = itersForScale(scaleF);
    const internal = parseFloat(resEl?.value || "0.70");

    // preview bits cap for speed
    const bitsUsed = (preview ? Math.min(baseBits, 160) : baseBits) | 0;
    const sh = baseBits - bitsUsed;

    // choose step
    const baseStep = parseInt(stepEl?.value || "2", 10);
    let step = ((opts && opts.hq) ? 1 : (preview ? Math.min(16, Math.max(6, baseStep*3)) : baseStep));
    if (opts && Number.isFinite(opts.forceStep)) step = Math.max(1, opts.forceStep|0);

    // fixed-point mapping
    // Use baseBits for center+scale mapping then downshift to bitsUsed to preserve location
    const centerXFix = f2fixed(centerX, baseBits);
    const centerYFix = f2fixed(centerY, baseBits);
    const scaleFix = f2fixed(scaleF, baseBits);

    const halfW = BigInt(Math.floor(W/2));
    const halfH = BigInt(Math.floor(H/2));
    let xmin = centerXFix - (halfW * scaleFix);
    let ymin = centerYFix - (halfH * scaleFix);

    let scale = scaleFix;
    if (sh > 0) {
      xmin >>= BigInt(sh);
      ymin >>= BigInt(sh);
      scale >>= BigInt(sh);
    }

    if (!workerOK || workers.length === 0) {
      // fallback
      renderStandard(token, opts);
      return;
    }

    clear();
    const strip = Math.max(24, Math.floor(H / (workerCount * 5)));
    const jobs = [];
    for (let y0=0; y0<H; y0+=strip){
      jobs.push({y0, rows: Math.min(strip, H-y0)});
    }

    let done = 0;
    const onMsg = (ev) => {
      const m = ev.data;
      if (!m || m.token !== token || m.type !== "strip") return;
      const data = new Uint8ClampedArray(m.buffer);
      // 防御：キャッシュ混線/サイズ変更などで data 長が合わない場合は捨てる
      const rowsFromData = Math.floor(data.length / (W * 4));
      if (rowsFromData <= 0 || rowsFromData * W * 4 !== data.length) return;
      if (m.startY + rowsFromData > H) return;

      const img = new ImageData(data, W, rowsFromData);
      ctx.putImageData(img, 0, m.startY);
done++;
      if (done >= jobs.length) {
        for (const w of workers) w.removeEventListener("message", onMsg);
        if (token !== renderToken) return;
        updateHUD("ultradeep "+(preview?"preview":"full"), performance.now()-start, iters, bitsUsed, step, internal.toFixed(2));
      }
    };
    for (const w of workers) w.addEventListener("message", onMsg);

    for (let i=0;i<jobs.length;i++){
      const w = workers[i % workerCount];
      const j = jobs[i];
      w.postMessage({
        type:"job",
        token,
        W,
        startY: j.y0,
        rows: j.rows,
        step,
        maxIter: iters,
        bits: bitsUsed,
        xmin,
        ymin,
        scale
      });
    }
  }

  function requestRender(reason="", opts={}){
    resize(false);
    const token = ++renderToken;
    try{
      if ((modeEl?.value || "ultradeep") === "standard") {
        renderStandard(token, opts);
      } else {
        // autoBits: keep image stable at deep zoom
        if (autoBitsEl?.checked) {
          // heuristic: bits ~ 120 + log2(magnification)*24 (clamped)
          const mag = Math.max(1, initialScale / scaleF);
          const need = Math.floor(120 + Math.log2(mag) * 24);
          const clamped = Math.max(96, Math.min(8192, need));
          bitsEl.value = String(Math.ceil(clamped / 64) * 64);
        }
        renderUltraDeep(token, opts);
      }
    }catch(e){
      showErr("[render exception]\n" + (e.stack || e.message || e));
    }
  }

  modeEl?.addEventListener("change", () => requestRender("mode", {preview:false}));
  resEl?.addEventListener("input", () => { resize(true); requestRender("res", {preview:true}); });
  stepEl?.addEventListener("change", () => requestRender("step", {preview:false}));
  iterEl?.addEventListener("change", () => requestRender("iters", {preview:false}));
  bitsEl?.addEventListener("change", () => requestRender("bits", {preview:false}));
  previewEl?.addEventListener("change", () => requestRender("preview", {preview:false}));
  autoBitsEl?.addEventListener("change", () => requestRender("autoBits", {preview:false}));
  autoSettleEl?.addEventListener("change", () => requestRender("autoSettle", {preview:false}));

  // First render
  resize(true);
  requestRender("boot", {preview:false});
})();
