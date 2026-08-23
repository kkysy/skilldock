# vendor/pdfjs

PDF.js — Mozilla 官方 PDF 渲染/解析库。

- 来源：npm 官方包 [`pdfjs-dist`](https://www.npmjs.com/package/pdfjs-dist)
- 版本：6.2.108
- 许可证：Apache-2.0（见本目录 `LICENSE`）

## 包含内容

| 文件/目录 | 用途 |
|-----------|------|
| `pdf.min.mjs` | 主库（ESM），通过 `shared/pdf.js` 懒加载 |
| `pdf.worker.min.mjs` | Web Worker，解析在 worker 线程执行 |
| `cmaps/` | CJK 等字体的字符映射（中文 PDF 文本提取必需） |
| `standard_fonts/` | PDF 标准 14 字体，渲染查看器页必需 |

请勿直接修改这些文件；升级时整体替换并更新上面的版本号。
