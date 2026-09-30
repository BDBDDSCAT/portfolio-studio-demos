# Wavebench

JavaScript 标量波传播库，配套 Node.js CLI 和浏览器实验仪器。
用于比较菲涅耳与角谱传播，检查复光场，并导出能够复现的参数研究结果。
另含理想透镜焦平面上的夫琅禾费模型。

```bash
node bin/wavebench.js simulate --preset double --method angular-spectrum --distance 100 --wavelength 532 --grid 512 --out out
node bin/wavebench.js scan --preset gaussian --waist 0.3 --method fresnel --start 10 --stop 500 --steps 21 --out scan
```

**[浏览器仪器](https://bdbddscat.github.io/portfolio-studio-demos/wavebench/)** ·
[English](README.md) · [日本語](README.ja.md)

[![Wavebench：输入光场、传播结果、采样诊断和距离扫描](docs/preview.png)](https://bdbddscat.github.io/portfolio-studio-demos/wavebench/)

## 计算与数据

- 三种模型：理想透镜焦平面夫琅禾费衍射、自由空间菲涅耳传递函数、自由空间角谱传播。
- 八种输入：单缝、双缝、光栅、圆孔、环形孔、涡旋、自定义振幅掩模、高斯光束。
- 8 × 8 mm 输入窗口，256 / 512 / 1024 网格；孔径支持平面或高斯照明。
- 输出复光场、原始相对辐照度、峰值归一化强度和相位，提供采样与边界诊断。
- 默认 21 个距离平面的扫描，显示中心截面的 x–z 热图并导出 CSV。
- 浏览器比较菲涅耳和角谱的复场、强度相对 L2 差异；支持本地图像转振幅掩模。
- 完整原生二维网格 CSV、中心截面 CSV、实验 JSON 和预览 PNG。
- 参数化输入支持确定性的 v2 分享链接，兼容 v1 夫琅禾费链接。
  自定义掩模通过 JSON 保存，灰度振幅采用 8 位精度。

菲涅耳与角谱可以比较同一个自由空间传播问题；透镜焦平面是另一种光学系统，
焦距与传播距离是独立参数。近场输出网格间距为 L/N，焦平面为 λf/L。
相位以弧度表示，输出复包络已去除均匀传播载波。
浏览器初始输入为 0.2 mm 腰半径的高斯光束，角谱传播距离为 250 mm。
浏览器扫描热图和 CSV 的 `global_normalized_intensity` 按所有中心截线的
同一个峰值归一化，保留不同距离间的相对峰值变化。CLI 扫描的
`normalized_intensity` 则按每个完整平面的峰值归一化；两者都保留原始强度。

## 运行

CLI 与测试需要 Node.js 22 或更新版本；浏览器使用静态 HTTP 服务：

```bash
git clone https://github.com/BDBDDSCAT/portfolio-studio-demos.git
cd portfolio-studio-demos/wavebench
npm test
python3 -m http.server 8080 --bind 127.0.0.1
```

打开 <http://127.0.0.1:8080>。正常运行无需安装 npm 包，无服务端、账号、
API 密钥、CDN 或运行时依赖。浏览器文件处理在本地完成。
库 API、CLI 参数与导出字段见 [docs/reference.md](docs/reference.md)。

## 验证范围

测试检查 FFT、能量关系、解析衍射图样和自由空间传播行为。
公式、测试依据和采样条件见 [docs/physics.md](docs/physics.md)。
这是计算光学学习、原型与可复现参数研究工具，不是经过认证的光学设计软件或
矢量 Maxwell 求解器。有限网格、FFT 周期边界、孔径离散化和传递函数采样
都会影响结果。已知源特征不足 6 个像素时会提示采样风险；自定义掩模的细节
和涡旋相位细节不由此检查覆盖，诊断通过不能代替网格收敛检查。

贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。采用 [MIT License](LICENSE)。
