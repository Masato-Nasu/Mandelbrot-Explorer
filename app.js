(() => {
  const BUILD = "20251214_v3";
  const canvas = document.getElementById("c");
  const hud = document.getElementById("hud");
  const errBox = document.getElementById("err");
  const autoBitsEl = document.getElementById("autoBits");
  const bitsEl = document.getElementById("bits");
  const stepEl = document.getElementById("step");
  const resetBtn = document.getElementById("resetBtn");
  const nukeBtn = document.getElementById("nukeBtn");

  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  let dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  let W = 0, H = 0;

  // Fixed-point camera:
  // value_real = value_fixed / 2^bits
  let bits = (parseInt(bitsEl.value, 10) || 512) | 0;
  let centerX = 0n;
  let centerY = 0n;
  let scale = 0n; // complex units per pixel in fixed
  let initialScale = 0n;

  function showError(e) {
    errBox.style.display = "block";
    errBox.textContent = String(e && e.stack ? e.stack : e);
  }
  function clearError() {
    errBox.style.display = "none";
    errBox.textContent = "";
  }

  // Helpers: Number -> fixed BigInt with current bits (safe for small magnitude inputs)
  function numToFixed(x, bitsNow) {
    const b = bitsNow | 0;
    const sign = x < 0 ? -1n : 1n;
    const ax = Math.abs(x);
    const hiBits = Math.min(53, b);
    const F = Math.pow(2, hiBits);
    const hi = BigInt(Math.round(ax * F));
    const shift = BigInt(Math.max(0, b - hiBits));
    return sign * (hi << shift);
  }

  function fixedBitLen(v) {
    const a = v < 0n ? -v : v;
    return a === 0n ? 0 : a.toString(2).length;
  }

  function ensurePrecision() {
    const L = fixedBitLen(scale);
    if (L > 0 && L < 90) {
      const add = 256;
      const sh = BigInt(add);
      centerX <<= sh;
      centerY <<= sh;
      scale   <<= sh;
      initialScale <<= sh;
      bits += add;
      bitsEl.value = String(bits);
    }
  }

  function maxIterForBits() {
    const it = 260 + Math.floor((bits - 256) * 1.8);
    return Math.max(300, Math.min(20000, it));
  }

  // Zoom factor approximation using pow2(k/den)
  const ZOOM_DEN = 1024;
  const ZOOM_Q = 60; // fixed bits for zoom multipliers
  const zoomTable = new Array(ZOOM_DEN);
  for (let i = 0; i < ZOOM_DEN; i++) {
    const v = Math.pow(2, i / ZOOM_DEN);
    zoomTable[i] = BigInt(Math.round(v * Math.pow(2, ZOOM_Q)));
  }

  function mulByZoomFactor(xFixed, q, r) {
    if (r !== 0) {
      xFixed = (xFixed * zoomTable[r]) >> BigInt(ZOOM_Q);
    }
    if (q > 0) xFixed <<= BigInt(q);
    else if (q < 0) xFixed >>= BigInt(-q);
    return xFixed;
  }

  function applyPow2K(k) {
    if (k === 0) return;
    let q = 0, r = 0;
    if (k > 0) {
      q = Math.floor(k / ZOOM_DEN);
      r = k - q * ZOOM_DEN;
    } else {
      const kk = -k;
      const q0 = Math.floor(kk / ZOOM_DEN);
      const r0 = kk - q0 * ZOOM_DEN;
      if (r0 === 0) {
        q = -q0; r = 0;
      } else {
        q = -(q0 + 1);
        r = ZOOM_DEN - r0;
      }
    }
    scale = mulByZoomFactor(scale, q, r);
    ensurePrecision();
  }

  function resetView() {
    bits = (parseInt(bitsEl.value, 10) || 512) | 0;
    centerX = numToFixed(-0.5, bits);
    centerY = numToFixed(0.0, bits);
    const s = 3.5 / Math.max(1, W);
    scale = numToFixed(s, bits);
    initialScale = scale;
    requestRender("reset");
  }

  function resize() {
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const cssW = Math.floor(window.innerWidth);
    const cssH = Math.floor(window.innerHeight);
    W = Math.max(1, Math.floor(cssW * dpr));
    H = Math.max(1, Math.floor(cssH * dpr));
    canvas.width = W;
    canvas.height = H;

    if (scale === 0n) resetView();
    else requestRender("resize");
  }
  window.addEventListener("resize", resize, { passive: true });

  function clearScreen() {
    ctx.fillStyle = "#0b0b0f";
    ctx.fillRect(0, 0, W, H);
  }

  // Workers
  const workerCount = Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 8));
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    const w = new Worker("./worker.js?b=" + encodeURIComponent(BUILD));
    w.onerror = (e) => showError(e.message || e);
    w.onmessageerror = (e) => showError("worker messageerror: " + e);
    workers.push(w);
  }

  let renderToken = 0;

  function updateHUD(reason="") {
    const magBits = (fixedBitLen(initialScale) - fixedBitLen(scale));
    const it = maxIterForBits();

    hud.textContent =
      `centerX = ${centerX}/2^${bits}\n` +
      `centerY = ${centerY}/2^${bits}\n` +
      `scale   = ${scale}/2^${bits}  (zoom≈2^${magBits})\n` +
      `iters   = ${it}\n` +
      `bits    = ${bits} ${autoBitsEl.checked ? "(auto)" : "(manual)"}\n` +
      `workers = ${workerCount}\n` +
      (reason ? `note   = ${reason}` : "");
  }

  function requestRender(reason="") {
    clearError();
    const token = ++renderToken;
    clearScreen();

    if (autoBitsEl.checked) {
      const L = fixedBitLen(scale);
      if (L > 0 && L < 140) {
        const add = 256;
        const sh = BigInt(add);
        centerX <<= sh;
        centerY <<= sh;
        scale   <<= sh;
        initialScale <<= sh;
        bits += add;
        bitsEl.value = String(bits);
      }
    }

    const iters = maxIterForBits();
    const step = Math.max(1, Math.min(16, (parseInt(stepEl.value, 10) || 2)));

    const halfW = BigInt(Math.floor(W / 2));
    const halfH = BigInt(Math.floor(H / 2));
    const xmin = centerX - halfW * scale;
    const ymin = centerY - halfH * scale;

    const strip = Math.max(16, Math.floor(H / (workerCount * 6)));
    const jobs = [];
    for (let y0 = 0; y0 < H; y0 += strip) {
      jobs.push({ y0, rows: Math.min(strip, H - y0) });
    }

    let done = 0;
    const total = jobs.length;

    function onMsg(ev) {
      const msg = ev.data;
      if (!msg || msg.token !== token) return;

      if (msg.type === "strip") {
        const { startY, rows, buffer } = msg;
        const data = new Uint8ClampedArray(buffer);
        const img = new ImageData(data, W, rows);
        ctx.putImageData(img, 0, startY);
        done++;
        if ((done % 8) === 0) updateHUD(`render ${done}/${total}`);
        if (done >= total) {
          for (const wk of workers) wk.removeEventListener("message", onMsg);
          updateHUD(reason);
        }
      } else if (msg.type === "error") {
        showError(msg.message || "worker error");
      }
    }

    for (const wk of workers) wk.addEventListener("message", onMsg);

    for (let i = 0; i < jobs.length; i++) {
      const w = workers[i % workerCount];
      const { y0, rows } = jobs[i];
      w.postMessage({
        type: "job",
        token,
        W,
        startY: y0,
        rows,
        step,
        maxIter: iters,
        bits,
        xmin,
        ymin,
        scale
      });
    }
  }

  // Interaction
  let isDragging = false;
  let lastX = 0, lastY = 0;

  function toCanvasXY(ev) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - rect.left) * dpr);
    const y = Math.floor((ev.clientY - rect.top) * dpr);
    return { x, y };
  }

  let renderDebounce = 0;
  function scheduleRender(reason) {
    clearTimeout(renderDebounce);
    renderDebounce = setTimeout(() => requestRender(reason), 60);
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

  canvas.addEventListener("pointerup", () => isDragging = false, { passive: true });
  canvas.addEventListener("pointercancel", () => isDragging = false, { passive: true });

  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const p = toCanvasXY(ev);

    const halfWn = Math.floor(W / 2);
    const halfHn = Math.floor(H / 2);
    const dx = BigInt(p.x - halfWn);
    const dy = BigInt(p.y - halfHn);

    const oldScale = scale;

    const speed = 0.0026;
    const k = Math.max(-ZOOM_DEN*64, Math.min(ZOOM_DEN*64, Math.round(ev.deltaY * speed * ZOOM_DEN)));
    applyPow2K(k);

    centerX += dx * (oldScale - scale);
    centerY += dy * (oldScale - scale);

    scheduleRender("zoom");
  }, { passive: false });

  canvas.addEventListener("dblclick", (ev) => {
    const p = toCanvasXY(ev);
    const halfWn = Math.floor(W / 2);
    const halfHn = Math.floor(H / 2);
    const dx = BigInt(p.x - halfWn);
    const dy = BigInt(p.y - halfHn);

    const oldScale = scale;
    const k = ev.shiftKey ? (ZOOM_DEN) : (-ZOOM_DEN); // *2 or /2
    applyPow2K(k);

    centerX += dx * (oldScale - scale);
    centerY += dy * (oldScale - scale);

    requestRender(ev.shiftKey ? "dbl zoom out" : "dbl zoom in");
  }, { passive: true });

  window.addEventListener("keydown", (ev) => {
    if (ev.key.toLowerCase() === "r") resetView();
  }, { passive: true });

  resetBtn.addEventListener("click", () => resetView());
  nukeBtn.addEventListener("click", () => {
    location.href = "./reset.html?cb=" + Date.now();
  });

  // UI bindings
  bitsEl.addEventListener("change", () => {
    if (autoBitsEl.checked) return;
    const newBits = Math.max(128, Math.min(32768, (parseInt(bitsEl.value, 10) || bits)));
    if (newBits === bits) return;
    const diff = newBits - bits;
    if (diff > 0) {
      const sh = BigInt(diff);
      centerX <<= sh; centerY <<= sh; scale <<= sh; initialScale <<= sh;
    } else {
      const sh = BigInt(-diff);
      centerX >>= sh; centerY >>= sh; scale >>= sh; initialScale >>= sh;
    }
    bits = newBits;
    requestRender("bits changed");
  });

  autoBitsEl.addEventListener("change", () => requestRender("auto bits"));
  stepEl.addEventListener("change", () => requestRender("step"));

  resize();
  updateHUD("ready");
})();