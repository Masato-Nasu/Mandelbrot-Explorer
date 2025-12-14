# Mandelbrot Explorer UltraDeep v6 (Turbo)

目的：
- BigInt固定小数点で「精度bitsを上げ続ける」ことで超深度ズームに対応（理論上無限）
- ただし重いので、探索中は preview を軽くし、必要な瞬間だけ HQ で描画

操作：
- ドラッグ：移動
- ホイール：ズーム
  - Alt：ターボ
  - Ctrl：ハイパー
  - Shift：微調整
- R：リセット
- HQ Render：step=1 & 内部解像度=1.0 で一発高精細

GitHub Pages で黒画面になる場合：
1) /reset.html を開く（SW/Cache掃除）
2) その後 / を開く

