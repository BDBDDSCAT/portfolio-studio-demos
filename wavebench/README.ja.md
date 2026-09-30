# Wavebench · 光の実験室

**[デモを開く](https://bdbddscat.github.io/portfolio-studio-demos/wavebench/)** · [English](README.md) · [简体中文](README.zh-CN.md)

小さな穴を描いて、光の行き先を見てみる。

ブラウザで動く回折の実験台です。スリット、円形開口、位相マスクの
条件を変えながら、焦点面の回折像と中心断面を観察できます。

[![Wavebench：開口、回折像、中心の強度断面](docs/preview.png)](https://bdbddscat.github.io/portfolio-studio-demos/wavebench/)

## 実際に使える機能

- 単スリット、二重スリット、回折格子、円形、環状、渦位相の6種類。
- 自分で開口を描画・消去し、振幅と位相を表示。
- 波長・焦点距離・開口の調整、線形表示と対数表示の切替。
- 距離目盛りつきの中心断面、PNG画像とCSVデータの書き出し。
- パラメータを共有リンクに保存。手描き開口はJSONセッションで保存・復元。

HTML / CSS / JavaScriptのみで構成。実行時の依存パッケージ、CDN、解析
スクリプト、APIキーは不要です。計算と書き出しはブラウザ内で完結します。
共有リンクには手描き開口の画素データは含まれません。

## 動かす

```bash
git clone https://github.com/BDBDDSCAT/portfolio-studio-demos.git
cd portfolio-studio-demos/wavebench
python3 -m http.server 8080 --bind 127.0.0.1
```

<http://127.0.0.1:8080> を開きます。利用するだけならnpmパッケージの
インストールは不要です。JavaScriptモジュールを使うため、HTTP経由で
開いてください。リンクのコピーにはHTTPSまたはlocalhostとブラウザの許可が必要です。

二重スリットの間隔を広げると、縞の間隔は狭くなります。円形開口を
小さくすると、中央の光点は広がります。

## モデルの範囲

理想レンズの焦点面における、単色・スカラーのフラウンホーファー回折を
2次元FFTで計算します。初期設定は8 mmの窓に512 × 512の格子。
各結果をそれぞれの最大値で正規化しているため、形状と相対強度の観察に
向いています。異なる開口の絶対的な明るさの比較には使えません。
細かな構造は格子の影響を受けます。近接場、偏光、レンズ収差は計算対象外です。

式とサンプリングの説明は [docs/physics.md](docs/physics.md)、テストと
貢献方法は [CONTRIBUTING.md](CONTRIBUTING.md) に記載しています。
[MIT License](LICENSE)。
