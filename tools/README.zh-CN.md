# 科学技术工具

J_photonics 的计算光学与实验数据工具。各项目都提供独立的 JavaScript 模块、
Node.js CLI 和浏览器工作台，可以直接复制对应目录单独使用。

**[打开工具导航](https://bdbddscat.github.io/portfolio-studio-demos/tools/)**

| 项目 | 用途 | 结果 |
| --- | --- | --- |
| [Wavebench](../wavebench/README.zh-CN.md) | 传播复数光场、比较数值模型 | 光场、相位、采样诊断、距离扫描 |
| [Thinfilm](../thinfilm/README.zh-CN.md) | 计算多层薄膜的光学响应 | s/p 偏振反射、透射、吸收及波长/角度扫描 |
| [Tracefit](../tracefit/README.zh-CN.md) | 从 CSV 光谱估计峰参数 | 高斯/洛伦兹峰、残差、收敛状态与局部误差 |
| [Runcheck](../runcheck/README.zh-CN.md) | 按 schema 检查实验 CSV | 规则错误、列统计、SHA256 哈希与独立报告 |

先模拟预期响应，再估计测量曲线的参数，最后检查实验记录。各项目保留原始数值，
并导出输入或配置，方便另一台机器复现结果。

浏览器中的文件处理都在本地完成。日常使用无需安装运行依赖、配置 API key 或搭建后端。
CLI 使用 Node.js 22 或更新版本，数值与命令行测试也不需要安装依赖。

从仓库根目录运行：

```sh
python3 -m http.server 8099 --bind 127.0.0.1
```

打开 <http://127.0.0.1:8099/tools/>。命令行参数、模块接口与导出格式见各项目文档。
在项目目录运行 `npm test`，可执行对应数值和 CLI 检查。

示例数据均为合成数据。光学模型采用理想化假设，拟合参数误差是局部近似；
数据质检只检查明确设置的规则。文档说明了适用范围，解释结果前应检查模型与收敛。

各项目附有独立的 MIT 许可证。

## 跨项目示例

从仓库根目录运行，输出目录需要尚不存在：

```sh
node tools/examples/beam-profile.mjs beam-study
node tools/examples/coating-audit.mjs coating-audit
```

第一个示例使用 Wavebench 生成高斯束中心截面，再让 Tracefit 拟合束宽并与解析解比较。
这是无噪声合成数据，参数误差不代表实际测量的不确定度。

第二个示例使用 Thinfilm 计算四分之一波减反膜，再让 Runcheck 检查波长顺序、
唯一键、数值范围和 `R + T + A = 1`。膜层配置、schema、原始 CSV 和带 SHA256 的
报告一并保存。守恒关系检查不能独立证明物理模型正确，物理验证见 Thinfilm 的解析测试。
