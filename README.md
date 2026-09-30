# J_photonics · scientific tools

[![Scientific tools checks](https://github.com/BDBDDSCAT/portfolio-studio-demos/actions/workflows/scientific-tools.yml/badge.svg)](https://github.com/BDBDDSCAT/portfolio-studio-demos/actions/workflows/scientific-tools.yml)

Computational optics and experimental data tools, with reusable JavaScript
modules, zero-runtime-dependency Node.js CLIs, and local browser instruments.

**[Open the scientific tools](https://bdbddscat.github.io/portfolio-studio-demos/tools/)** ·
[中文使用说明](tools/README.zh-CN.md) · [Source archives & release notes](https://github.com/BDBDDSCAT/portfolio-studio-demos/releases/tag/scientific-tools-v1.0.0)

| Project | Problem it solves | Browser | Source & docs |
| --- | --- | --- | --- |
| **Wavebench** | Complex-field propagation, sampling diagnostics, model comparison, distance sweeps | [Open](https://bdbddscat.github.io/portfolio-studio-demos/wavebench/) | [wavebench/](wavebench/README.md) |
| **Thinfilm** | Multilayer reflection, transmission and absorption; s/p wavelength and angle scans | [Open](https://bdbddscat.github.io/portfolio-studio-demos/thinfilm/) | [thinfilm/](thinfilm/README.md) |
| **Tracefit** | Gaussian/Lorentzian peak fitting with baseline, residuals and local uncertainty | [Open](https://bdbddscat.github.io/portfolio-studio-demos/tracefit/) | [tracefit/](tracefit/README.md) |
| **Runcheck** | Experimental CSV validation: composite keys, ranges, scan order and balance rules | [Open](https://bdbddscat.github.io/portfolio-studio-demos/runcheck/) | [runcheck/](runcheck/README.md) |

Each project is independent: copy its directory, import its modules, or run its
CLI using Node.js 22+. Optical and statistical conventions are documented beside
the code. Examples are synthetic and are labeled as such. Numerical tests use
analytic references and known inputs; browser tests exercise actual file imports,
computations, and exports. Each tool has an MIT license.

```sh
git clone https://github.com/BDBDDSCAT/portfolio-studio-demos.git
cd portfolio-studio-demos
python3 -m http.server 8099 --bind 127.0.0.1
```

Open <http://127.0.0.1:8099/tools/>. No build or package installation is needed
for the instruments. Run `npm test` inside a tool directory for numerical and CLI
checks. Development dependencies are needed only for browser tests.
See [the tool index](tools/README.md) for the workflow and individual READMEs
for commands, API examples, export formats, and limitations.

## Web & automation portfolio

日本語のWebデザインと、小規模な自動化の自主制作ポートフォリオです。

**デモサイト：https://bdbddscat.github.io/portfolio-studio-demos/**

掲載しているブランド、商品、顧客名、注文データは架空です。受注実績や実在商品の紹介ではありません。AI支援を活用して制作しています。

## 作品

| デモ | 表現 | 実際に使える機能 |
|---|---|---|
| [茶房 余白](https://bdbddscat.github.io/portfolio-studio-demos/demos/ink.html) | 水墨画、縦書き、余白 | 季節切替、淹れ方ダイアログ、URLへの状態反映 |
| [Luma](https://bdbddscat.github.io/portfolio-studio-demos/demos/light.html) | 製品ビジュアル、スクロール連動 | 構図・見出し変化、色温度スライダー、プリセット |
| [こつこつ観測所](https://bdbddscat.github.io/portfolio-studio-demos/demos/pixel.html) | ピクセルアート、ゲーム風UI | 集中・休憩タイマー、開始・一時停止、タスク保存と削除の取り消し |
| [Order Desk](https://bdbddscat.github.io/portfolio-studio-demos/demos/minimal.html) | ミニマル、データ中心 | 検索、絞り込み、並び替え、確認後金額入力、CSV出力 |
| [つくるメモ](https://bdbddscat.github.io/portfolio-studio-demos/demos/doodle.html) | 控えめな手描き、付箋、手順図 | 制作内容の選択、範囲の即時更新、依頼文コピー、テキスト保存 |

## 動かす

HTML / CSS / JavaScriptのみで構成。依存パッケージ、外部APIキー、ビルド作業は不要です。

```sh
python3 -m http.server 8099 --bind 127.0.0.1
```

`http://127.0.0.1:8099` を開きます。クリップボードはHTTPSまたはlocalhostで利用できます。コピー不可の環境ではテキスト保存が使えます。

## データ処理サンプル

`downloads/python-demos.zip` に、日本語の説明、合成データ、Pythonコード、テストを同梱しています。

- 注文CSVの正規化・重複確認・金額照合
- 合成光学CSVの入力検証・run単位の集計

`Order Desk` の初期値はこのPythonサンプルで生成した結果です。Web画面の操作はブラウザ内のみで動作し、CSVのPython処理は別途実行します。ファイルのアップロード、顧客管理サーバー、決済、実際の予約送信は実装していません。

## 制作方針と参考

- [Anthropic frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design)：対象に合わせた視覚設計、タイポグラフィ、構図の検討。
- [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)：スタイルの分類と設計方針を調査。検索スクリプトの導入・実行は行っていません。
- [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines)：ラベル、フォーカス、減速設定、操作結果の表示を確認。

外部技能のコードや文章をサイトへ転載したものではありません。各ページは個別の配色・構図・CSSで実装しています。水墨画、ライト、ピクセルアートは、このデモ用に生成したオリジナル画像です。プロンプトは `docs/image-prompts.md` に記載。

動きの軽減設定を尊重し、フォームのラベル・キーボード操作・確認ダイアログを備えています。対応状況と検証範囲は `docs/verification.md` に記載します。

## 制作の相談

[ココナラのプロフィール](https://coconala.com/users/5586100)から、入力資料・完成イメージ・希望納期を添えてご相談ください。

## Wavebench · 光の実験室

JavaScriptのスカラー波動光学ライブラリ、Node.js CLI、ブラウザの数値実験コンソールです。Fresnel・角スペクトルの自由空間伝搬と、理想レンズ焦点面のFraunhofer場を計算します。複素振幅・位相・未正規化の相対強度を保持し、距離走査、モデル比較、サンプリング診断、ネイティブ格子のCSV出力を備えます。有限格子と周期境界の制約は、モデル文書に明記しています。

[デモ](https://bdbddscat.github.io/portfolio-studio-demos/wavebench/) · [ソースと使い方](wavebench/README.ja.md) · [English](wavebench/README.md) · [中文](wavebench/README.zh-CN.md)

単独で動かす場合は `wavebench/` をHTTPサーバーで配信してください。数値・状態の検証はNode.js 22以降の `npm test`、ブラウザ検証はPlaywrightです。Wavebench部分は [MIT License](wavebench/LICENSE) で公開しています。
