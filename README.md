# Mandelbrot Explorer v7 (UltraDeep)

ブラウザ上でマンデルブロ集合を**無限スクロール感覚でズーム探索**しつつ、必要な瞬間だけ **HQ Render** で作品品質に引き上げられる Mandelbrot Explorer です。  
v7では特に「**深度（bits）を上げられる UltraDeep**」「**カーソル中心ズーム**」「**HQの美しさ**」を優先して仕上げています。

---

## Screenshot

![Mandelbrot Explorer v7 – HQ Render](docs/screenshot.png)

---

## Demo
- GitHub Pages: `https://masato-nasu.github.io/Mandelbrot-Explorer/`
- キャッシュ掃除: `https://masato-nasu.github.io/Mandelbrot-Explorer/reset.html`

---

## Features

### UltraDeep (BigInt)
- **BigInt固定小数点**で精度（bits）を上げ続けられる深度ズーム対応
- 深くなるほど重くなりますが、**HQ Render** で最終的に高精細を狙えます

### Standard (float64)
- 軽く探索したいとき用（深度は通常の倍精度範囲）

### 操作性
- **カーソル位置へ向かってズーム**（カーソル中心ズーム）
- **ホイール回転方向：反転**（直感に合う方向へ）

### HQ Render（作品品質）
- **段階的に高精細化（step 6 → 3 → 2 → 1）**
- 内部解像度を上げ、境界ディテールを潰さず描き切る

### PNG保存
- **Save PNGボタン**でその時点のキャンバスを保存
- **Sキー**でも保存

### 黒画面・混線対策
- `reset.html` で **Service Worker / Cache Storage** を掃除
- 「Cache Nuke」ボタンからも `reset.html` に移動できます

---

## Controls

### マウス / トラックパッド
- **ホイール**：ズーム（カーソル中心）  
  - **Alt**：ターボ  
  - **Ctrl**：ハイパー（深度を一気に稼ぐ）  
  - **Shift**：微調整
- **ドラッグ**：パン（移動）

### キーボード
- **R**：Reset（初期位置へ）
- **S**：Save PNG（画像保存）

---

## UI Parameters
- **モード**：UltraDeep / Standard
- **内部解像度**：内部レンダリング解像度（高いほど綺麗・重い）
- **step（粗さ）**：ピクセル間引き（小さいほど綺麗・重い）
- **反復上限（iters）**：ディテール（高いほど綺麗・重い）
- **bits（精度）**：UltraDeepの精度（深度が上がるほど必要）
- **Auto bits**：ズームに応じて bits を自動調整

---

## “重い”ときのおすすめ運用

**探索（快適優先）**
- 内部解像度：0.55〜0.75
- step：6〜12
- iters：控えめ
- UltraDeepの場合 bits は Auto 任せ（深度に応じて増えるので重くなります）

**作品化（静止してHQ）**
- **HQ Render** を押す  
  → step を段階的に 1 まで落として、最終的に高精細に収束します  
- 仕上がったら **Save PNG**（またはS）

---

## Files
- `index.html` … UI/起動
- `app.js` … 描画・操作・ワーカー管理
- `worker.js` … 計算（並列描画）
- `reset.html` … キャッシュ掃除（黒画面対策の要）
- `favicon.ico` … アイコン
- `README.md`

---

## Local Run
静的ファイルなので、ローカルサーバで動きます。

```bash
python -m http.server 8000
```

---

## Deploy (GitHub Pages)
1. リポジトリ直下にファイル一式を配置
2. GitHub Pages を有効化
3. 更新後、動作が怪しい場合は必ず一度：
   - `/reset.html` を開いてキャッシュ掃除
   - その後 `/` を開く

---

## Troubleshooting

### 黒画面 / 変な挙動になる
- まず `/reset.html` を開いてキャッシュ掃除  
- それでもダメなら、ブラウザの「キャッシュの消去とハード再読み込み」

### 重すぎる
- 内部解像度を下げる（0.55〜0.70）
- stepを上げる（6〜12）
- HQは「最終レンダ」だけにする

---

## License
MIT
