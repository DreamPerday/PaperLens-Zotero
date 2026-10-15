# PaperLens for Zotero

帮助读懂和核对论文的 AI 阅读助手。直接使用 Zotero 的 PDF 阅读器，在常驻侧栏里提问、精读、生成概览和核对论文依据。

当前版本为 **0.1.0**，要求 **Zotero 10.0.6–10.x**。已在 Windows 的 Zotero 10.0.6 中验证；macOS、Linux 和其他 Zotero 版本尚未实机验证。

## 安装与开始阅读

1. 打开 [最新发布版本](https://github.com/DreamPerday/PaperLens-Zotero/releases/latest)，在 **Assets** 中下载 `paperlens-zotero-0.1.0.xpi`。从源码构建时，文件位于 `dist/`。
2. 打开 Zotero → **工具 → 插件**，点击齿轮 → **从文件安装插件**，选择此 XPI。
3. 打开一份本机 PDF，点击阅读器工具栏的 **PaperLens**，或右侧 PaperLens 图标。
4. 在侧栏的 **设置** 中填写 AI 服务的 **Base URL、API Key、模型 ID**。也可以从 Zotero 设置左侧的 **PaperLens** 进入。
5. 点击 **获取模型** 后选择模型，或手动填写。**测试连接** 使用当前表单；测试成功后点击 **保存设置**。
6. 在 PDF 中选中句子或段落，点击选文工具中的 **问 PaperLens**，输入自己的问题并发送。

支持 OpenAI 兼容中转站和本地模型，Base URL 可以是服务根地址或 `/v1` 地址。服务未开放模型列表时，手动填写模型 ID 即可。模型列表只代表服务公布的 ID，实际可用性通过连接测试确认。

插件不需要启动现有桌面版、Electron、Python 后端或 PaddleOCR，也不需要 PaddleOCR Key。扫描件须先获得可用文字层。

## 四种阅读任务

| 任务 | 用法 |
| --- | --- |
| 问答 | 围绕选句、段落或本篇论文自由提问，支持连续追问 |
| 精读 | 选中原文后分析，解释词句、概念、论证作用及相关段落 |
| 概览 | 提取研究问题、方法、结果、贡献和局限；长文分段后汇总 |
| 核对 | 输入一个主张或选中结论，检查原文支持程度和适用范围 |

切换任务、选文、解释深度或示例问题不会自动调用 AI。解释深度可选“简明 / 标准 / 深入”；阅读提示可以在设置中关闭。

回答逐步显示，支持 **停止生成** 和失败后的 **重试**。停止保留已收到的文字；长文概览保留已完成的分段结果，重试会重新执行本次分析。上下文预算是单次原文的字符预算，并不等于模型的总 Token 容量，需为提示词、对话和回答预留空间。

点击回答中的页码依据可在 PDF 中定位并临时高亮，**返回阅读位置** 返回跳转前的位置。支持独立 PDF 窗口的嵌入式侧栏，可拖动分隔条调整宽度，收起后从工具栏重新打开。

**历史** 显示本篇全部任务记录。**清空本篇记录** 需要在侧栏内确认，已保存的 Zotero 笔记保留。**重读原文** 重新提取 PDF 文字；替换 PDF 后，旧解读保留，旧引用禁止沿用。

**保存为笔记** 为论文创建 Zotero 子笔记，包含问题、解读、选文、页级来源链接、模型和生成时间。独立附件会创建独立笔记。插件内引用保留区域坐标；普通笔记链接提供页级回跳，不会为每条 AI 引用创建原生高亮。

## 数据与隐私

- AI Key 使用 Zotero 所在环境的 Mozilla 凭据存储 `Services.logins`，不写入普通配置、笔记或 XPI。
- 服务地址、模型、深度和上下文预算保存在 `extensions.paperlens.settings` 偏好中。
- 原文索引及阅读记录存放在 **Zotero 数据目录下的 `paperlens/`**，按 `libraryID_attachmentKey` 区分附件，使用 JSON 保存。
- 论文问答、精读等主动操作会向用户配置的服务发送相关原文及近期对话；模型发现和连接测试同样会访问配置的服务。
- 阅读历史只在本机保存。主动保存的 Zotero 笔记遵循用户的 Zotero 同步设置；卸载插件会保留本机阅读记录和笔记。
- 插件没有账号、租户体系、遥测或后台资料库批量上传。

## 当前边界

只分析 Zotero 提取出的文字、可提取公式文本和图注。首版不做图片内容理解、扫描件 OCR、联网事实查证、跨论文比较或底层模型训练；公式按文本展示，未集成专门的公式排版器。

精读以当前选文为单位，不包含一键逐节批注。段落关联使用选文邻近段落与关键词相关原文，复杂排版的提取质量仍取决于 Zotero。跨页段落保存多个位置，块引用默认定位到首个片段。核对中的“当前依据不足”不等于主张错误。

插件通过本仓库的 `updates.json` 检查新版本，也可以从 [Releases](https://github.com/DreamPerday/PaperLens-Zotero/releases) 下载 XPI 手动更新。从独立仓库发布前的本机开发版迁移时，请手动安装一次本仓库的 XPI，以切换到新的更新地址。插件 ID 保持不变，本机设置和阅读记录可继续使用。

## 构建与扩展

安装 Git 和 Node.js 20 或更新版本，克隆独立插件仓库后运行：

```powershell
git clone https://github.com/DreamPerday/PaperLens-Zotero.git
cd PaperLens-Zotero
npm ci
npm run check
npm test
npm run build
```

构建只打包 `addon/` 与编译后的运行资源，产物在 `dist/paperlens-zotero-0.1.0.xpi`。开发脚本、测试库、凭据和阅读数据均不进入 XPI。

| 文件 | 负责的能力 |
| --- | --- |
| `src/host.ts` | 原生入口、侧栏、独立窗口、设置页及生命周期 |
| `src/zotero-adapter.ts` | SDT 文本提取、坐标跳转、笔记与附件身份 |
| `src/reading/normalize.ts` | Zotero 结构化文本到可引用原文块 |
| `src/reading/context.ts` | 上下文选取、四种任务提示词、长文分段 |
| `src/ai/client.ts` | 兼容 API、模型列表、流式响应和停止 |
| `src/controller.ts` | 任务、历史、停止重试与来源关联 |
| `src/storage.ts` | 设置、凭据、本地索引与历史 |
| `src/ui/` | 侧栏内容和交互 |

后续优先扩展图表按需理解、原文查找、可选 OCR 和跨论文核对。新增能力应先接入同一套附件身份、原文位置与明确触发动作，避免增加第二套文献管理界面。

## 隔离开发与验证

本地测试可使用独立 Zotero 配置和合成 PDF，不连接个人资料库。下列命令从仓库根目录运行；先完成 `npm ci` 和 `npm run build`，Python 仅用于生成测试材料：

```powershell
python -m pip install reportlab
python scripts/create-fixtures.py
node scripts/dev-profile.mjs --launch --zotero "C:\Program Files\Zotero\zotero.exe"
```

`--zotero` 改为本机程序路径。脚本在仓库 `output/zotero-dev/` 建立独立 profile 和 data，关闭同步与自动更新；本地调试端口为 6101，测试插件通过本地文件桥接执行检查。仅用于隔离开发，不要将此 profile 或开发测试插件安装到个人配置。已运行时先关闭测试 Zotero，再重新执行启动命令。

另开终端运行本地模拟 AI 服务，再执行原生检查：

```powershell
node scripts/mock-relay.mjs
# 在另一终端中运行：
node scripts/command.mjs scripts/native-smoke.js
```

当前验收范围见 [验收记录](verification.md)。模拟服务验证功能流程，不能证明真实模型的论文理解质量。

## 发布维护

版本号分别位于 `package.json` 和 `addon/manifest.json`。发布时同时更新这两处与锁文件，运行上述检查及构建，将 XPI 上传至对应版本的 GitHub Release，再更新 `updates.json` 的版本、兼容范围与 `update_link`。已发布标签和安装包应保持不变，后续修订发布为新版本。

GitHub Actions 会在推送和拉取请求中执行类型检查、单元测试和构建，并保留 XPI 构建产物。普通用户从 Releases 下载正式安装包即可。
