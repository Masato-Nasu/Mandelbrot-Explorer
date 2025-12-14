(() => {
  const BUILD = "20251214_v6_2_turbo_shiftzoom";

  const canvas = document.getElementById("c");
  const hud = document.getElementById("hud");
  const errBox = document.getElementById("errBox");

  const autoBitsEl = document.getElementById("autoBits");
  const bitsEl = document.getElementById("bits");
  const stepEl = document.getElementById("step");
  const previewEl = document.getElementById("preview");
  const autoSettleEl = document.getElementById("autoSettle");
  const resEl = document.getElementById("res");
  const iterCapEl = document.getElementById("iterCap");

  const resetBtn = document.getElementById("resetBtn");
  const nukeBtn = document.getElementById("nukeBtn");
  const hqBtn = document.getElementById("hqBtn");

  function showError(text) {
    if (!errBox) return;
    errBox.style.display = "block";
    errBox.textContent = String(text);
  }
  function clearError() {
    if (!errBox) return;
    errBox.style.display = "none";
    errBox.textContent = "";
  }

  window.addEventListener("error", (e) => {
    showError(`[window.error]\n${e.message}\n${e.filename}:${e.lineno}:${e.colno}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    showError(`[unhandledrejection]\n${(r && (r.stack || r.message)) || r}`);
  });

  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  let dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  let cssW = 1, cssH = 1;
  let W = 1, H = 1;

  // Fixed-point (BigInt): value / 2^bits
  let bits = Math.max(64, Math.min(8192, parseInt(bitsEl?.value || "512", 10) || 512)) | 0;
  const B = () => BigInt(bits);

  // View params
  let centerX = 0n;
  let centerY = 0n;
  let scale = 1n;        // complex units per pixel, fixed-point
  let initialScale = 1n; // for HUD zoom reference

  function fixedBitLen(x) {
    // approximate magnitude by bit length
    const ax = x < 0n ? -x : x;
    if (ax === 0n) return 0;
    return ax.toString(2).length;
  }

  // ---- Worker pool ----
  const workerCount = Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 8));
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    const w = new Worker("./worker.js?b=" + encodeURIComponent(BUILD));
    w.onerror = (e) => showError(e.message || e);
    w.onmessageerror = (e) => showError("worker messageerror: " + e);
    workers.push(w);
  }

  let renderToken = 0;

  function clearScreen() {
    ctx.fillStyle = "#0b0b0f";
    ctx.fillRect(0, 0, W, H);
  }

  function clampBits(v) {
    return Math.max(64, Math.min(8192, v | 0));
  }

  function maxIterForScale(s) {
    // scaleが小さい＝深いので少し上げる（capはUIで）
    const mag = Math.max(0, (fixedBitLen(initialScale) - fixedBitLen(s)));
    const it = 220 + Math.floor(mag * 2.4);
    return Math.max(200, Math.min(20000, it));
  }

  function getUI() {
    const res = Math.max(0.30, Math.min(1.0, parseFloat(resEl?.value || "0.65") || 0.65));
    const step = Math.max(1, Math.min(16, parseInt(stepEl?.value || "2", 10) || 2));
    const cap = Math.max(200, Math.min(20000, parseInt(iterCapEl?.value || "1200", 10) || 1200));
    const preview = !!(previewEl && previewEl.checked);
    const autoSettle = !!(autoSettleEl && autoSettleEl.checked);
    const autoBits = !!(autoBitsEl && autoBitsEl.checked);
    return { res, step, cap, preview, autoSettle, autoBits };
  }

  function updateHUD(note = "") {
    const magBits = fixedBitLen(initialScale) - fixedBitLen(scale);
    const it = Math.min(maxIterForScale(scale), getUI().cap);

    hud.textContent =
      `centerX = ${centerX}/2^${bits}\n` +
      `centerY = ${centerY}/2^${bits}\n` +
      `scale   = ${scale}/2^${bits}  (zoom≈2^${magBits})\n` +
      `iters   = ${it} (cap=${getUI().cap})\n` +
      `res     = ${getUI().res.toFixed(2)} (dpr=${dpr.toFixed(2)})\n` +
      `bits    = ${bits} ${getUI().autoBits ? "(auto)" : "(manual)"}\n` +
      `workers = ${workerCount}\n` +
      (note ? `note   = ${note}` : "");
  }

  function resize(keep = true) {
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    cssW = Math.max(1, Math.floor(window.innerWidth));
    cssH = Math.max(1, Math.floor(window.innerHeight));

    const { res } = getUI();
    W = Math.max(1, Math.floor(cssW * dpr * res));
    H = Math.max(1, Math.floor(cssH * dpr * res));
    canvas.width = W;
    canvas.height = H;

    // CSS size remains full screen; we render lower internally
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";

    if (!keep) resetView();
  }

  function numToFixed(x) {
    // conservative conversion: use 53-bit float mantissa then shift
    const sign = x < 0 ? -1n : 1n;
    const ax = Math.abs(x);
    const hiBits = Math.min(53, bits);
    const F = Math.pow(2, hiBits);
    const hi = BigInt(Math.round(ax * F));
    const shift = BigInt(bits - hiBits);
    return sign * (hi << shift);
  }

  function resetView() {
    clearError();
    // Standard starting point
    centerX = numToFixed(-0.5);
    centerY = numToFixed(0.0);

    // initial scale: view width about 3.5
    const s = 3.5 / Math.max(1, W);
    scale = numToFixed(s);
    initialScale = scale;

    requestRender("reset", { preview: false });
  }

  // ---- Rendering ----
  function requestRender(reason = "", opts = {}) {
    clearError();
    const token = ++renderToken;

    const ui = getUI();

    // Auto bits: scale が小さくなってBigIntが太る前に bits を増やして精度を維持
    if (ui.autoBits) {
      // scaleのbit長が小さすぎる（=固定小数点の分解能不足）ならbitsを増やして余裕を作る
      const L = fixedBitLen(scale);
      if (L > 0 && L < 160 && bits <= 7936) {
        const add = 256;
        const sh = BigInt(add);
        centerX <<= sh;
        centerY <<= sh;
        scale   <<= sh;
        initialScale <<= sh;
        bits = clampBits(bits + add);
        if (bitsEl) bitsEl.value = String(bits);
      }
    }

    const itBase = Math.min(maxIterForScale(scale), ui.cap);
    const isPreview = !!opts.preview;
    const isHQ = !!opts.hq;

    const iters = isHQ ? Math.min(Math.max(itBase, 1500), ui.cap) : (isPreview ? Math.min(itBase, 700) : itBase);

    // 探索用：previewは粗く軽く。停止後/hqはユーザーのstepを尊重（HQは強制1）
    const step = isHQ ? 1 : (isPreview ? Math.min(16, Math.max(6, ui.step * 3)) : ui.step);

    // プレビューはbitsを落として計算（BigIntが小さくなるので激効く）
    const PREVIEW_BITS_CAP = 192;
    const bitsUsed = isPreview ? Math.min(bits, PREVIEW_BITS_CAP) : bits;
    const shBits = bits - bitsUsed;

    const halfW = (W / 2) | 0;
    const halfH = (H / 2) | 0;

    // xmin/ymin in fixed point
    const xmin = centerX - BigInt(halfW) * scale;
    const ymin = centerY - BigInt(halfH) * scale;

    const xmin2 = shBits > 0 ? (xmin >> BigInt(shBits)) : xmin;
    const ymin2 = shBits > 0 ? (ymin >> BigInt(shBits)) : ymin;
    const scale2 = shBits > 0 ? (scale >> BigInt(shBits)) : scale;

    clearScreen();

    const strip = Math.max(16, Math.floor(H / (workerCount * 6)));
    const jobs = [];
    for (let y0 = 0; y0 < H; y0 += strip) {
      jobs.push({ y0, rows: Math.min(strip, H - y0) });
    }

    let done = 0;

    const onMsg = (ev) => {
      const msg = ev.data;
      if (!msg || msg.type !== "strip" || msg.token !== token) return;
      const data = new Uint8ClampedArray(msg.buffer);
      const img = new ImageData(data, W, msg.startY ? msg.rows : msg.rows);
      // We used ImageData width=W and rows=msg.rows; put at startY
      ctx.putImageData(img, 0, msg.startY);
      done++;
      if (done >= jobs.length) {
        for (const wk of workers) wk.removeEventListener("message", onMsg);
        updateHUD(reason + (isPreview ? " (preview)" : isHQ ? " (HQ)" : ""));
      }
    };

    for (const wk of workers) wk.addEventListener("message", onMsg);

    for (let i = 0; i < jobs.length; i++) {
      const wk = workers[i % workerCount];
      const j = jobs[i];
      wk.postMessage({
        type: "job",
        token,
        W,
        startY: j.y0,
        rows: j.rows,
        step,
        maxIter: iters,
        bits: bitsUsed,
        xmin: xmin2,
        ymin: ymin2,
        scale: scale2
      });
    }
  }

  // ---- Interaction ----
  function toCanvasXY(ev) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - rect.left) * dpr * getUI().res);
    const y = Math.floor((ev.clientY - rect.top) * dpr * getUI().res);
    return { x: Math.max(0, Math.min(W - 1, x)), y: Math.max(0, Math.min(H - 1, y)) };
  }

  let isDragging = false;
  let lastX = 0, lastY = 0;

  let renderDebounce = 0;
  let settleTimer = 0;

  function scheduleRender(reason = "") {
    clearTimeout(renderDebounce);
    renderDebounce = setTimeout(() => requestRender(reason, { preview: true }), 40);

    if (getUI().autoSettle) {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => requestRender("settle", { preview: false }), 220);
    }
  }

  canvas.addEventListener("pointerdown", (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    isDragging = true;
    const p = toCanvasXY(ev);
    lastX = p.x; lastY = p.y;
  }, { passive: true });

  canvas.addEventListener("pointermove", (ev) => {
    if (!isDragging) return;
    const p = toCanvasXY(ev);
    const dx = p.x - lastX;
    const dy = p.y - lastY;
    lastX = p.x; lastY = p.y;

    centerX -= BigInt(dx) * scale;
    centerY -= BigInt(dy) * scale;

    scheduleRender("pan");
  }, { passive: true });

  canvas.addEventListener("pointerup", () => { isDragging = false; }, { passive: true });
  canvas.addEventListener("pointercancel", () => { isDragging = false; }, { passive: true });

  // Shift-zoom wheel: power-of-two zoom via bit shifts (fast & deep-friendly)
  let wheelAcc = 0;
  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const { x: px, y: py } = toCanvasXY(ev);

    const ui = getUI();

    const base = 0.020;                   // 通常（大きいほど一気）
    const fine = ev.shiftKey ? 0.25 : 1.0; // Shiftで細かく
    const turbo = ev.altKey ? 4.0 : 1.0;   // Altでターボ
    const hyper = ev.ctrlKey ? 12.0 : 1.0; // Ctrlでハイパー

    const dyN = ev.deltaY * (ev.deltaMode === 1 ? 16 : 1);
    wheelAcc += dyN * base * fine * turbo * hyper;

    const k = (wheelAcc > 0) ? Math.floor(wheelAcc) : Math.ceil(wheelAcc);
    if (k === 0) return;
    wheelAcc -= k;

    // cursor anchored zoom using integer shift k:
    // k>0 => zoom out (scale << k)
    // k<0 => zoom in  (scale >> -k)
    const dx = BigInt(px - ((W / 2) | 0));
    const dy = BigInt(py - ((H / 2) | 0));

    const xBefore = centerX + dx * scale;
    const yBefore = centerY + dy * scale;

    if (k > 0) {
      const sh = BigInt(Math.min(60, k)); // safety clamp per event
      scale <<= sh;
    } else {
      const sh = BigInt(Math.min(60, -k));
      scale >>= sh;
      if (scale <= 0n) scale = 1n;
    }

    const xAfter = centerX + dx * scale;
    const yAfter = centerY + dy * scale;

    centerX += (xBefore - xAfter);
    centerY += (yBefore - yAfter);

    scheduleRender("zoom");
  }, { passive: false });

  window.addEventListener("keydown", (ev) => {
    if (ev.key.toLowerCase() === "r") resetView();
  }, { passive: true });

  resetBtn?.addEventListener("click", () => resetView());
  nukeBtn?.addEventListener("click", () => { location.href = "./reset.html"; });

  hqBtn?.addEventListener("click", () => {
    // HQ: renderScale=1.0 and step=1, no preview bits cap
    if (resEl) resEl.value = "1.00";
    if (stepEl) stepEl.value = "1";
    resize(true);
    requestRender("HQ", { hq: true, preview: false });
  });

  // Bits change (manual): rescale fixed point to new bits
  bitsEl?.addEventListener("change", () => {
    const newBits = clampBits(parseInt(bitsEl.value, 10) || bits);
    if (newBits === bits) return;
    const diff = newBits - bits;
    if (diff > 0) {
      const sh = BigInt(diff);
      centerX <<= sh; centerY <<= sh; scale <<= sh; initialScale <<= sh;
    } else {
      const sh = BigInt(-diff);
      centerX >>= sh; centerY >>= sh; scale >>= sh; initialScale >>= sh;
      if (scale <= 0n) scale = 1n;
    }
    bits = newBits;
    requestRender("bits changed", { preview: false });
  });

  autoBitsEl?.addEventListener("change", () => requestRender("auto bits", { preview: false }), { passive: true });
  stepEl?.addEventListener("change", () => requestRender("step", { preview: false }), { passive: true });
  resEl?.addEventListener("input", () => { resize(true); scheduleRender("res"); }, { passive: true });
  iterCapEl?.addEventListener("change", () => requestRender("iter cap", { preview: false }), { passive: true });

  // init
  resize(true);
  resetView();
  updateHUD("ready");
})();