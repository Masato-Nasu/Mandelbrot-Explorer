# Mandelbrot Explorer UltraDeep v7

黒画面を潰すために、app.jsを全面書き直した安定版です。

特徴
- UltraDeep(BigInt) / Standard(float64) 切替
- 操作中プレビュー（粗く・軽い）→停止後に高精細（任意）
- 画面下にエラーを赤表示（DevTools不要）
- app.js/worker.js はクエリ付きで読み込み（キャッシュ混線を減らす）

GitHub Pages 手順
1) ZIPの中身をリポジトリ直下へ全部上書き
2) /reset.html を一度開いてキャッシュ掃除
3) / を開く

操作
- ドラッグ：移動
- ホイール：ズーム（Alt/Ctrl/Shift で倍率）
- R：リセット
- HQ Render：一発だけ高精細（重い）


## v7.4 additions
- HQ Render: progressive refinement (step 6→3→2→1)
- Save PNG button / S key
