# Wavebench

JavaScriptのスカラー波動伝搬ライブラリ。Node.js CLIとブラウザの計算装置を備えます。
フレネル伝搬と角スペクトル伝搬を比較し、複素場と物理座標の値を確認して、
再現可能なパラメータ計算を保存できます。理想レンズ焦点面のフラウンホーファー計算も含みます。

```bash
node bin/wavebench.js simulate --preset double --method angular-spectrum --distance 100 --wavelength 532 --grid 512 --out out
node bin/wavebench.js scan --preset gaussian --waist 0.3 --method fresnel --start 10 --stop 500 --steps 21 --out scan
```

**[ブラウザで使う](https://bdbddscat.github.io/portfolio-studio-demos/wavebench/)** ·
[English](README.md) · [简体中文](README.zh-CN.md)

[![Wavebench：入力場、伝搬結果、標本化の診断、距離走査](docs/preview.png)](https://bdbddscat.github.io/portfolio-studio-demos/wavebench/)

## 計算と出力

- 理想レンズ焦点面のフラウンホーファー、自由空間のフレネル伝達関数、角スペクトルの3方式。
- 単スリット、二重スリット、回折格子、円形、環状、渦位相、任意振幅マスク、ガウスビームの8入力。
- 8 × 8 mmの入力窓、256 / 512 / 1024の格子。開口には平面波またはガウス照明を指定できます。
- 複素場、正規化前の相対照度、最大値で正規化した強度、位相と標本化・境界の診断。
- 初期値21面の距離走査。中心断面のx–zヒートマップとCSV出力。
- 同一入力のフレネル・角スペクトル複素場と強度の相対L2差分比較。ローカル画像の振幅マスク読込。
- 格子全体のCSV、中心断面CSV、実験JSON、プレビューPNG。
- パラメータ入力のv2共有リンクと従来のv1リンク読込。
  手描きマスクはJSONに保存し、振幅は8 bitで量子化します。

フレネルと角スペクトルは同じ自由空間問題を比較できます。レンズ焦点面は
別の光学配置なので、焦点距離と伝搬距離を区別してください。
自由空間の出力間隔はL/N、焦点面はλf/L。位相はラジアンで、複素包絡から
一様な伝搬キャリアを除いています。
ブラウザの初期値はウエスト半径0.2 mmのガウスビーム、角スペクトル方式、
伝搬距離250 mmです。ブラウザのヒートマップとCSVの
`global_normalized_intensity` は、全中心断面の同じ最大値で正規化します。
CLIの `normalized_intensity` は各2次元面の最大値で正規化します。
どちらも正規化前の強度を保持します。

## 動かす

CLIと数値テストにはNode.js 22以降を使用します。ブラウザは静的HTTPで配信します。

```bash
git clone https://github.com/BDBDDSCAT/portfolio-studio-demos.git
cd portfolio-studio-demos/wavebench
npm test
python3 -m http.server 8080 --bind 127.0.0.1
```

<http://127.0.0.1:8080> を開きます。通常利用のパッケージ導入、サーバー側処理、
アカウント、APIキー、CDN、実行時依存パッケージは不要です。ブラウザのファイル
処理は端末内で完結します。[docs/reference.md](docs/reference.md) にAPI・CLI・出力形式を記載しています。

## 検証範囲

FFT、エネルギー関係、解析的な回折像、自由空間伝搬を数値テストで確認します。
式と検証条件は [docs/physics.md](docs/physics.md) に記載しています。
計算光学の学習、試作、再現可能なパラメータ計算を対象とし、検証済みの光学設計
ソフトやベクトルMaxwellソルバーではありません。有限格子、FFTの周期境界、
開口の離散化、伝達関数の標本化に制約があります。既知の入力特徴が6画素未満なら
警告しますが、任意マスクや渦位相の細部は推定しません。診断結果は格子収束確認の代わりにはなりません。

[CONTRIBUTING.md](CONTRIBUTING.md) · [MIT License](LICENSE)
