# Mandelbrot Ultra Deep Zoom (Infinite Precision) - 20251214_v3

## 起動
- ローカル: `python -m http.server`
- 開く: http://localhost:8000/

※ `file://` 直開きだと Worker が動かず黒画面になりがちです。

## 黒画面のとき（GitHub Pagesで特に多い）
1. `reset.html` を一度開いてください（Service Worker / Cache を削除）
2. その後 `index.html` に戻ります

## 操作
- Drag: pan
- Wheel: zoom (cursor anchored)
- Double click: zoom in
- Shift + Double click: zoom out
- R: reset

## 仕組み
- カメラ（中心/スケール）は **BigInt の固定小数点**で保持（bitsを増やせば任意精度）
- 描画は Web Worker に分割


BUILD: 20251214_v4_fast


## v4 Fast tips
- 内部解像度を 0.5 / 0.35 に下げると体感が大きく軽くなります。
- 操作中プレビューONで、ドラッグ/ズーム中は粗く、止まると精細描画に戻ります。
- iters上限を下げると境界が軽くなります。
