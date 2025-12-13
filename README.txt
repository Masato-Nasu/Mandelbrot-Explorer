Mandelbrot Ultra Deep Zoom

- Run with a local HTTP server (required for workers/service worker):
  python -m http.server
  open http://localhost:8000/

Controls:
- Drag: pan
- Wheel: zoom (keeps cursor fixed)
- Double click: zoom in, Shift + double click: zoom out
- R: reset

Notes:
- This version uses BigInt-based BigFloat in CPU workers for ultra deep zoom.
- For extremely deep zoom, use Quality(step)=2 or 4, and/or increase precision bits.
