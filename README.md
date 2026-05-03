# SILK-TS

纯 TypeScript 实现的 Skype SILK v3 音频编解码器。

本项目是 SILK 定点数参考实现的位精确（bit-exact）移植，专为 Node.js 和浏览器环境中的高性能音频编码和解码而设计。

## 特性

- **精确一致**：通过自动化矩阵测试，确保与 C 语言参考实现完全一致。
- **纯 TypeScript**：零原生依赖（开发工具除外），具备极佳的可移植性。
- **支持全采样率**：支持 8kHz (NB)、12kHz (MB)、16kHz (WB) 和 24kHz (SWB)。
- **可变码率 (VBR)**：支持动态码率调整。
- **丢包隐藏 (PLC)**：内置处理丢包的机制。

## 项目结构

- `src/`：SILK 编码器和解码器的核心源码。
- `test/`：矩阵测试套件和位精确验证脚本。
- `silkc/`：用于验证的 C 参考二进制文件目录。

## 快速开始

### 安装

```bash
pnpm install
```

### 构建

```bash
pnpm run build
```

### 运行测试

为验证位精确一致性，请确保 `silkc/` 目录下存在 `Encoder.exe` 和 `Decoder.exe`，然后运行：

```bash
pnpm test
```

## 矩阵测试

本项目采用严格的矩阵测试方法，在各种参数（采样率、码率、包时长、丢包等）组合下，验证 TypeScript 实现与 C 参考实现结果完全匹配。

## 致谢与来源

本项目代码主要移植自以下项目，该项目提供了 SILK v3 的参考实现和 C 二进制包：
- [silk-v3-decoder](https://github.com/kn007/silk-v3-decoder) (MIT 协议)

## 辅助编程
Claude Opus4.6

## 许可证

本项目遵循 MIT 许可证。详细内容请参阅 [LICENSE](LICENSE) 文件。

Copyright (c) 2026. 基于原始 SILK v3 移植。

