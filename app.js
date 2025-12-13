(() => {
  const canvas = document.getElementById("c");
  const hud = document.getElementById("hud");
  const errBox = document.getElementById("err");
  const autoBitsEl = document.getElementById("autoBits");
  const bitsEl = document.getElementById("bits");
  const stepEl = document.getElementById("step");

  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

  let dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  let W = 0, H = 0;

  // View params (as JS Numbers)
  let centerX = -0.5;
  let centerY = 0.0;
  let scale = 0;         // complex units per pixel
  let initialScale = 0;

  const DOUBLE_TO_FIXED_SWITCH = 1e-12; // below this, fixed-point in worker is used

  const workerCount = Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 8));
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    const w = new Worker("./worker.js"); // classic worker (no module) for maximum compatibility
    w.onerror = (e) => showError(`Worker error: ${e.message || e.type}`);
    workers.push(w);
  }

  window.addEventListener("error", (e) => {
    showError(`Error: ${e.message}\n${e.filename}:${e.lineno}:${e.colno}`);
  });

  function showError(msg) {
    errBox.style.display = "block";
    errBox.textContent = msg;
  }
  function clearError() {
    errBox.style.display = "none";
    errBox.textContent = "";
  }

  function resize() {
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const cssW = Math.floor(window.innerWidth);
    const cssH = Math.floor(window.innerHeight);
    W = Math.max(1, Math.floor(cssW * dpr));
    H = Math.max(1, Math.floor(cssH * dpr));
    canvas.width = W;
    canvas.height = H;

    if (!initialScale) {
      initialScale = 3.5 / W; // roughly cover [-2.5..1]
      scale = initialScale;
    }
    requestRender("resize");
  }
  window.addEventListener("resize", resize, { passive: true });

  function maxIterForScale(s) {
    const magnification = initialScale / s;
    const it = 260 + Math.floor(80 * Math.log(Math.max(1, magnification)));
    return Math.max(250, Math.min(20000, it));
  }

  function computeAutoBits() {
    // Choose bits so that scale*(2^bits) has enough integer magnitude.
    // bits ~ -log2(scale) + margin
    const margin = 80; // safety margin
    const s = Math.max(scale, 1e-320);
    const bits = Math.ceil(-Math.log2(s)) + margin;
    // clamp for UI sanity
    return Math.max(256, Math.min(16384, bits));
  }

  function updateHUD(reason = "") {
    const magnification = initialScale / scale;
    const iters = maxIterForScale(scale);
    const mode = (scale < DOUBLE_TO_FIXED_SWITCH) ? "fixed(BigInt)" : "double(Number)";
    const bits = autoBitsEl.checked ? computeAutoBits() : (parseInt(bitsEl.value, 10) || 512);
    const step = Math.max(1, Math.min(16, parseInt(stepEl.value, 10) || 2));

    hud.textContent =
`center = (${centerX.toPrecision(16)}, ${centerY.toPrecision(16)})
scale  = ${scale.toExponential(6)}  (magnification ≈ ${magnification.toExponential(3)}x)
iters  = ${iters}
mode   = ${mode}
bits   = ${bits} ${autoBitsEl.checked ? "(auto)" : "(manual)"}
step   = ${step}
workers= ${workerCount}
${reason ? "note   = " + reason : ""}`;
  }

  function clearScreen() {
    ctx.fillStyle = "#0b0b0f";
    ctx.fillRect(0, 0, W, H);
  }

  let renderToken = 0;

  // Progressive passes: coarse -> fine
  const passes = [
    { stepMul: 4, label: "coarse x4" },
    { stepMul: 2, label: "coarse x2" },
    { stepMul: 1, label: "full" },
  ];

  function requestRender(reason = "") {
    clearError();
    updateHUD("rendering… " + reason);
    const token = ++renderToken;
    clearScreen();

    const iters = maxIterForScale(scale);
    const baseStep = Math.max(1, Math.min(16, parseInt(stepEl.value, 10) || 2));

    // Schedule passes sequentially
    (async () => {
      for (const p of passes) {
        if (token !== renderToken) return;
        const step = Math.max(1, baseStep * p.stepMul);
        await renderPass(token, iters, step, p.label);
      }
      if (token === renderToken) updateHUD(reason);
    })().catch((e) => showError(`Render failed: ${e && e.message ? e.message : String(e)}`));
  }

  function renderPass(token, iters, step, label) {
    return new Promise((resolve) => {
      const useFixed = (scale < DOUBLE_TO_FIXED_SWITCH);

      const jobs = [];
      const strip = Math.max(16, Math.floor(H / (workerCount * 6)));
      for (let y0 = 0; y0 < H; y0 += strip) {
        jobs.push({ y0, rows: Math.min(strip, H - y0) });
      }

      let done = 0;

      // Prepare payload
      if (!useFixed) {
        const xmin = centerX - (Math.floor(W / 2) * scale);
        const ymin = centerY - (Math.floor(H / 2) * scale);

        for (let i = 0; i < jobs.length; i++) {
          const w = workers[i % workerCount];
          const { y0, rows } = jobs[i];
          w.postMessage({
            type: "job",
            token, W, H,
            mode: "double",
            xmin, ymin, scale,
            maxIter: iters,
            startY: y0,
            rows,
            step
          });
        }
      } else {
        const bits = autoBitsEl.checked ? computeAutoBits() : (parseInt(bitsEl.value, 10) || 512);
        bitsEl.value = String(bits);

        // Convert center/scale to fixed-point with given bits
        const F = Math.pow(2, Math.min(53, bits)); // for conversion range (safe up to 2^53)
        // For bits > 53, we split: x * 2^bits = x * 2^53 * 2^(bits-53)
        const shift = Math.max(0, bits - 53);

        function toFixedBig(x) {
          // x is JS Number (small magnitude)
          const hi = Math.round(x * F); // integer within safe range if x ~ [-3..3]
          let bi = BigInt(hi);
          if (shift > 0) bi = bi << BigInt(shift);
          return bi;
        }

        const centerXfp = toFixedBig(centerX);
        const centerYfp = toFixedBig(centerY);
        const scalefp = toFixedBig(scale); // scale is tiny, but x*F may underflow if too tiny => hi=0
        // If scale underflowed (became 0), bump bits automatically
        if (scalefp === 0n) {
          // raise bits and retry once
          const newBits = Math.min(16384, bits + 512);
          bitsEl.value = String(newBits);
          autoBitsEl.checked = true;
          requestRender("auto bits bumped");
          resolve();
          return;
        }

        const wHalf = BigInt(Math.floor(W / 2));
        const hHalf = BigInt(Math.floor(H / 2));
        const xminfp = centerXfp - wHalf * scalefp;
        const yminfp = centerYfp - hHalf * scalefp;

        for (let i = 0; i < jobs.length; i++) {
          const w = workers[i % workerCount];
          const { y0, rows } = jobs[i];
          w.postMessage({
            type: "job",
            token, W, H,
            mode: "fixed",
            bits,
            xminfp: xminfp.toString(),
            yminfp: yminfp.toString(),
            scalefp: scalefp.toString(),
            maxIter: iters,
            startY: y0,
            rows,
            step
          });
        }
      }

      const onMessage = (ev) => {
        const msg = ev.data;
        if (!msg || msg.token !== token) return;

        if (msg.type === "strip") {
          const { startY, rows, buffer } = msg;
          const data = new Uint8ClampedArray(buffer);
          const img = new ImageData(data, W, rows);
          ctx.putImageData(img, 0, startY);

          done++;
          if ((done % 8) === 0 && token === renderToken) updateHUD(label);

          if (done >= jobs.length) {
            for (const wk of workers) wk.removeEventListener("message", onMessage);
            resolve();
          }
        } else if (msg.type === "log") {
          // optional
          // console.log(msg.message);
        } else if (msg.type === "error") {
          showError(msg.message || "Worker error");
        }
      };

      for (const wk of workers) wk.addEventListener("message", onMessage);
    });
  }

  // ---- Interaction ----
  let isDragging = false;
  let lastX = 0, lastY = 0;

  function toCanvasXY(ev) {
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * dpr;
    const y = (ev.clientY - rect.top) * dpr;
    return { x, y };
  }

  function pixelToComplex(px, py) {
    const x = centerX + (px - Math.floor(W / 2)) * scale;
    const y = centerY + (py - Math.floor(H / 2)) * scale;
    return { x, y };
  }

  let renderDebounce = 0;
  function scheduleRender(reason) {
    clearTimeout(renderDebounce);
    renderDebounce = setTimeout(() => requestRender(reason), 70);
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
    centerX -= dx * scale;
    centerY -= dy * scale;
    scheduleRender("pan");
  }, { passive: true });

  canvas.addEventListener("pointerup", () => { isDragging = false; }, { passive: true });
  canvas.addEventListener("pointercancel", () => { isDragging = false; }, { passive: true });

  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const { x: px, y: py } = toCanvasXY(ev);
    const before = pixelToComplex(px, py);

    const factor = Math.exp(ev.deltaY * 0.0016);
    const newScale = scale * factor;
    scale = Math.max(1e-330, Math.min(10, newScale));

    const after = pixelToComplex(px, py);
    centerX += (before.x - after.x);
    centerY += (before.y - after.y);

    scheduleRender("zoom");
  }, { passive: false });

  canvas.addEventListener("dblclick", (ev) => {
    const { x: px, y: py } = toCanvasXY(ev);
    const before = pixelToComplex(px, py);

    const zoomIn = !ev.shiftKey;
    const factor = zoomIn ? 0.5 : 2.0;
    scale = Math.max(1e-330, Math.min(10, scale * factor));

    const after = pixelToComplex(px, py);
    centerX += (before.x - after.x);
    centerY += (before.y - after.y);

    requestRender(zoomIn ? "dbl zoom in" : "dbl zoom out");
  }, { passive: true });

  autoBitsEl.addEventListener("change", () => requestRender("auto bits toggle"), { passive: true });
  bitsEl.addEventListener("change", () => requestRender("bits change"), { passive: true });
  stepEl.addEventListener("change", () => requestRender("step change"), { passive: true });

  window.addEventListener("keydown", (ev) => {
    if (ev.key.toLowerCase() === "r") {
      centerX = -0.5; centerY = 0.0;
      scale = initialScale || (3.5 / Math.max(1, W));
      requestRender("reset");
    }
  }, { passive: true });

  // ---- PWA ----
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try { await navigator.serviceWorker.register("./sw.js"); } catch {}
    });
  }

  resize();
  updateHUD("ready");
})();