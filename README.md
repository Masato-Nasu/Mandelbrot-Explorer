# Mandelbrot Ultra Deep Zoom (Infinite Precision)

- Drag: pan
- Wheel: zoom (keeps pointer position stable)
- Double click: zoom in
- Shift + double click: zoom out
- R: reset

## Run
Use a local server (Workers need http/https).

```bash
python -m http.server
# open http://localhost:8000/
```

## Ultra deep zoom
This app uses:
- fast **double** (JS Number) mode for normal zoom
- **fixed-point BigInt** mode automatically below a certain scale

If it becomes slow, increase **品質(step)** to 4 or 8.

If you ever see precision artifacts at extreme zoom, keep **Auto bits** ON
(or increase `bits` manually).
