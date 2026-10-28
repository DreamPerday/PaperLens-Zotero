# PaperLens for Zotero

帮助读懂和核对论文的 AI 阅读助手。直接使用 Zotero 的 PDF 阅读器，在常驻侧栏里提问、精读、生成概览和核对论文依据。

当前版本为 **0.3.8**，在选文自动翻译基础上新增多服务商、内置离线词典、单词本地路由、失败内容替换、期刊分区信息、在线出版信息查询和 EasyScholar 自定义数据集；可从 [Releases](https://github.com/DreamPerday/PaperLens-Zotero/releases/latest) 下载正式安装包。要求 **Zotero 10.0.6–10.x**。已在 Windows 的 Zotero 10.0.6 中验证；macOS、Linux 和其他 Zotero 版本尚未实机验证。

## 安装与开始阅读

1. 打开 [最新发布版本](https://github.com/DreamPerday/PaperLens-Zotero/releases/latest)，在 **Assets** 中下载 `paperlens-zotero-0.3.8.xpi`。从源码构建时，文件位于 `dist/`。
2. 打开 Zotero → **工具 → 插件**，点击齿轮 → **从文件安装插件**，选择此 XPI。
3. 打开一份本机 PDF，点击阅读器工具栏的 **PaperLens**，或右侧 PaperLens 图标。
4. 在侧栏的 **设置** 中添加服务商，并填写各自的 **显示名称、Base URL、API Key、模型 ID**。可以保存多个服务商；从 Zotero 设置左侧的 **PaperLens** 也可以进入。
5. 选择要测试的服务商，点击 **获取模型** 后选择模型，或手动填写。**测试此服务商** 使用当前表单；测试成功后点击 **保存设置**。
6. 在 PDF 中选中句子或段落，点击选文工具中的 **问 PaperLens**，输入自己的问题并发送。

支持配置多个 OpenAI 兼容服务商、中转站和本地模型。每个服务商拥有独立的 Base URL、Key、模型和显示名称，可分别测试；在设置页点击 **设为当前** 后，问答、概览、注解和长句翻译只使用选中的服务商。Base URL 可以是服务根地址或 `/v1` 地址。服务未开放模型列表时，手动填写模型 ID 即可。

插件不需要启动现有桌面版、Electron、Python 后端或 PaddleOCR，也不需要 PaddleOCR Key。扫描件须先获得可用文字层。

## 四种阅读任务

| 任务 | 用法 |
| --- | --- |
| 问答 | 围绕选句、段落或本篇论文自由提问，支持连续追问 |
| 注解 | 选中原文后逐句分析；也可以不选文，一键按段落生成全文注解 |
| 概览 | 提取研究问题、方法、结果、贡献和局限；长文分段后汇总 |
| 证据核对 | 输入一个具体主张或选中结论，判断支持、部分支持或当前依据不足，并列出限制 |

## 期刊与分区

选中论文条目后，Zotero **信息** 区会出现 **期刊 / 出版物** 和 **JCR / 中科院分区** 两行。期刊直接写入 Zotero 标准出版字段；会议论文、图书章节和预印本会使用对应出版物字段。

第三条 **会议等级（CCF / CORE）** 只用于会议论文。分区和会议等级写入条目标签，例如 `PaperLens/JCR-Q1`、`PaperLens/CAS-2`、`PaperLens/CCF-A`、`PaperLens/CORE-A*`，可以在 Zotero 标签区筛选和同步。编辑时可输入 `Q1`、`中科院 1区`、`CCF-A` 或 `CORE-A*`，留空可清除。标签名称保持纯文字，不添加图案前缀；插件会直接设置 Zotero 标签颜色。

条目侧栏新增 **出版信息** 小节，提供醒目的 **在线查询出版信息** 按钮；也可以在论文条目上右键选择 **PaperLens：在线查询出版信息**。插件会通过 DOI/标题匹配 OpenAlex、Crossref 和 arXiv，先显示论文类型、出版来源、年份和 CCF/CORE 等级，确认后写入条目。EfficientNet 会识别为 ICML 2019、CCF-A、CORE-A*。

在设置中填写 EasyScholar 开放接口密钥后，插件还会调用 EasyScholar `getPublicationRank` 接口，读取 `sci`、`sciUp`、`sciBase`、`ccf` 和自定义数据集字段，自动填写 JCR、中科院分区和 CCF。密钥在 EasyScholar 官网登录后从 **开放接口** 页面获取，并保存在本机 Zotero 凭据库。

用户账号启用的 EasyScholar 自定义数据集也会写入条目并在 **出版信息** 中显示彩色徽标；例如数据集中返回 `hzau` 时显示为 **华中农业大学**。插件不内置未经核验的华农分级表，因此需要在 EasyScholar 中启用对应数据集后才能查询到等级。

EasyScholar 的 `rankInfo` 只描述数据集可用档位；实际论文等级必须由 `rank` 中的 UUID 配对确定。若 `rank` 为空，查询确认框会显示“华中农业大学：未匹配”及可选档位，但不会把 A+/A/B/C 中的某一项误写成论文等级。插件在未匹配到自定义数据集等级时会继续尝试去掉年份等后缀后的出版物名称。

EasyScholar 设置中可以关闭“显示接口返回的全部数据集”，再勾选需要的数据集，或直接填写 `HZAU`、`UIBE` 等接口简称。过滤只影响自定义数据集；JCR、中科院分区和 CCF 始终保留。在线查询会自动记录接口返回的数据集清单，供后续勾选。

选择保存后，下一次在线查询只写入并显示选中的数据集；已有条目需要重新执行一次在线查询来清理不需要的旧数据集标签。

侧栏中切换任务、带入选文、改变解释深度或示例问题不会自动生成回答；开启选文自动翻译时，PDF 选文会单独调用翻译。解释深度可选“简明 / 标准 / 深入”；阅读提示可以在设置中关闭。

回答逐步显示，支持 **停止生成** 和失败后的 **重试**。回答支持 GFM Markdown、表格、代码块和 LaTeX 数学公式（行内 `$...$`、独立 `$$...$$`），长公式可以横向滚动。中文标点紧邻加粗标记、AI 在加粗边界误加空格时也可正常显示；代码示例中的 Markdown 与公式分隔符保持原样。停止保留已收到的文字；全文概览和全文注解保留已完成的分段结果，重试会重新执行本次分析。上下文预算是单次原文的字符预算，并不等于模型的总 Token 容量，需为提示词、对话和回答预留空间。

点击回答中的页码依据可在 PDF 中定位并临时高亮，**返回阅读位置** 返回跳转前的位置。支持独立 PDF 窗口的嵌入式侧栏，可拖动分隔条调整宽度，收起后从工具栏重新打开。
在“注解”任务中，默认开启“跟随正文”：滚动 PDF、翻页或跳转时，注解区会按当前阅读位置自动滚到对应段落的来源标题并高亮。点击“跟随正文”可暂停，再次点击会恢复并定位当前段落；浏览历史时暂停自动滚动。点击注解来源仍会反向定位正文。联动使用现有注解的来源引用，不额外调用 AI；没有来源引用的旧注解需要重新生成。

侧栏顶部显示紧凑的当前服务商和 **模型** 按钮，点击后可切换服务商、刷新模型列表、搜索模型名称并切换当前模型；支持方向键选择、Enter 确认、Esc 关闭。切换后立即保存，不需要进入设置页；Base URL 或 Key 变化仍在 **设置** 中修改。回答生成期间需先停止或等待结束，再切换服务商或模型。菜单采用浮层，展开时不会挤压阅读区，长模型列表可滚动。**历史** 显示本篇全部任务记录。重新发起同一任务的问答、概览或注解时，会移除该任务此前的失败、停止或空白回答及其对应问题，完整历史不受影响。**清空本篇记录** 需要在侧栏内确认，已保存的 Zotero 笔记保留。**重读原文** 重新提取 PDF 文字；替换 PDF 后，旧解读保留，旧引用禁止沿用。

**保存为笔记** 为论文创建 Zotero 子笔记，包含问题、解读、选文、页级来源链接、模型和生成时间。独立附件会创建独立笔记。插件内引用保留区域坐标；普通笔记链接提供页级回跳，不会为每条 AI 引用创建原生高亮。

## 选文翻译浮窗

配置 AI 后，在 PDF 中选中句子或段落，停留约半秒即可自动显示简体中文译文。翻译不需要打开侧栏或输入问题；请求只包含当前选文，不会读取整篇论文作为翻译上下文，也不会写入问答历史。

选区是单个英文单词时，默认优先查询内置的离线英汉词典。词典命中后直接显示中文释义，不发起网络或模型请求；内置词典收录约 5.8 万条常见、考试和较高频词条，并支持常见复数、过去式和进行时的词形还原。

离线词典未命中时，可以在设置中指定专用的 **单词翻译服务商**，建议使用本机 Ollama/LM Studio 的小模型。单词请求使用更短的词典提示词，只访问该专用服务，不调用当前远程服务商，因此不会消耗远程 Token。短语、句子和段落仍使用当前服务商。设置中也可以通过 **本地模型** 快捷添加默认的 Ollama 地址 `http://127.0.0.1:11434/v1` 和 `qwen2.5:0.5b` 示例，模型需要用户自行安装。

浮窗支持流式译文、Markdown 与数学公式、展开原文、复制、停止和重试。拖动标题栏可移动浮窗，长译文在窗内滚动。点击关闭、按 Esc、重新选择其他原文、追问或关闭阅读器时收起浮窗。设置中的 **点击浮窗外或滚动 PDF 时保持译文打开** 默认开启，方便边看原文边读译文；关闭后会恢复为点击其他区域或滚动页面时自动收起。未完成的翻译会在明确关闭或更换选文时取消。

在浮窗底部或 PaperLens 设置中关闭 **选中后自动翻译**，此后选文不再自动请求模型，需要时点击原生选文工具栏的 **翻译**。点击 **在侧栏追问** 会将同一选文带入问答，用户输入问题后才发起问答请求。

## 数据与隐私

- 每个服务商的 AI Key 分别使用 Zotero 所在环境的 Mozilla 凭据存储 `Services.logins`，不写入普通配置、笔记或 XPI。
- 服务商列表、显示名称、服务地址、模型、当前服务商、单词翻译服务商、深度、上下文预算和自动翻译偏好保存在 `extensions.paperlens.settings` 偏好中。
- 期刊写入条目标准出版字段；分区写入条目标签，并遵循 Zotero 自身的数据同步规则。
- 离线词典随 XPI 本地提供，词条查询不会上传选中的单词。
- 原文索引及阅读记录存放在 **Zotero 数据目录下的 `paperlens/`**，按 `libraryID_attachmentKey` 区分附件，使用 JSON 保存。
- 论文问答、精读等主动操作会向用户配置的服务发送相关原文及近期对话；开启自动翻译时，选中 PDF 文字会将选文发送到同一服务。模型发现和连接测试同样会访问配置的服务。
- 主动使用在线出版查询时，会将论文标题或 DOI 发送到 OpenAlex、Crossref 或 arXiv；CCF/CORE 匹配使用插件内置的 CCFDDL 精简榜单，不额外上传论文内容。
- 配置 EasyScholar 密钥后，查询还会将论文的期刊或会议名称发送给 EasyScholar 开放接口，以获取等级数据。
- 阅读历史只在本机保存。主动保存的 Zotero 笔记遵循用户的 Zotero 同步设置；卸载插件会保留本机阅读记录和笔记。
- 插件没有账号、租户体系、遥测或后台资料库批量上传。

## 当前边界

只分析 Zotero 提取出的文字、可提取公式文本和图注。当前不做图片内容理解、扫描件 OCR、联网事实查证、跨论文比较或底层模型训练；公式在回答中使用 KaTeX 排版，输入 PDF 的公式提取质量仍取决于 Zotero。

注解有选文时以当前选文为单位，没有选文时按原文分段处理整篇论文；长文按上下文预算分批生成并保留段落来源。段落关联使用邻近段落与关键词相关原文，复杂排版的提取质量仍取决于 Zotero。跨页段落保存多个位置，块引用默认定位到首个片段。证据核对中的“当前依据不足”表示本文范围内证据不够，不等于主张错误。

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

构建只打包 `addon/` 与编译后的运行资源，产物在 `dist/paperlens-zotero-0.3.8.xpi`。KaTeX 样式、字体、精简离线词典和 CCF/CORE 榜单随安装包提供，界面脚本与样式使用版本化文件名，避免升级后沿用旧样式。开发脚本、测试库、凭据和阅读数据均不进入 XPI。

| 文件 | 负责的能力 |
| --- | --- |
| `src/host.ts` | 原生入口、侧栏、独立窗口、设置页及生命周期 |
| `src/zotero-adapter.ts` | SDT 文本提取、坐标跳转、笔记与附件身份 |
| `src/reading/position.ts` | 将 PDF 阅读视口匹配到原文块，驱动正文与注解联动 |
| `src/reading/normalize.ts` | Zotero 结构化文本到可引用原文块 |
| `src/reading/context.ts` | 上下文选取、四种任务提示词、长文分段 |
| `src/ai/client.ts` | 兼容 API、模型列表、流式响应和停止 |
| `src/controller.ts` | 任务、历史、停止重试与来源关联 |
| `src/history.ts` | 新请求替换同任务失败或中断的旧回答 |
| `src/paper-metadata.ts` | 期刊标准字段、JCR/中科院分区标签 |
| `src/paper-online.ts` | OpenAlex、Crossref、arXiv 出版信息查询与确认写入 |
| `src/paper-ranks/ccf.json` | 由 CCFDDL 生成的 CCF/CORE 会议等级索引 |
| `src/translation/` | 选文翻译请求、浮窗定位、拖动与生命周期 |
| `src/translation/dictionary.json` | 由 ECDICT 生成的精简离线英汉词库 |
| `src/settings.ts` | 多服务商设置、旧配置迁移和当前服务商选择 |
| `src/storage.ts` | 多服务商凭据、本地索引与历史 |
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
node scripts/command.mjs scripts/ui-smoke.js
node scripts/command.mjs scripts/annotation-smoke.js
node scripts/command.mjs scripts/resize-smoke.js
node scripts/command.mjs scripts/history-smoke.js
node scripts/command.mjs scripts/metadata-smoke.js
node scripts/command.mjs scripts/online-smoke.js
node scripts/command.mjs scripts/translation-smoke.js
node scripts/command.mjs scripts/translation-drag-smoke.js
node scripts/command.mjs scripts/translation-window-smoke.js
```

离线词典可通过 `python scripts/build-dictionary.py` 从 MIT 许可的 ECDICT 数据重新生成；来源和许可证说明见 `src/translation/OFFLINE_DICTIONARY.md`。
会议等级数据可通过 `python scripts/build-ccf.py` 从 MIT 许可的 CCFDDL 公开目录重新生成；来源说明随 XPI 提供在 `content/CCF_DATA.txt`。

验证不重启升级时，先在隔离 profile 中运行旧版本并执行一次原生检查，再构建新版本，运行 `node scripts/command.mjs scripts/upgrade-smoke.js`；它会安装仓库当前版本并检查新版脚本与样式是否生效。

当前验收范围见 [验收记录](verification.md)。模拟服务验证功能流程，不能证明真实模型的论文理解质量。

## 发布维护

版本号分别位于 `package.json` 和 `addon/manifest.json`。发布时同时更新这两处与锁文件，运行上述检查及构建，将 XPI 上传至对应版本的 GitHub Release，再更新 `updates.json` 的版本、兼容范围与 `update_link`。已发布标签和安装包应保持不变，后续修订发布为新版本。

GitHub Actions 会在推送和拉取请求中执行类型检查、单元测试和构建，并保留 XPI 构建产物。普通用户从 Releases 下载正式安装包即可。

## 开源许可证

PaperLens for Zotero 采用 [MIT 许可证](LICENSE)，版权归 DreamPerday 所有。允许使用、修改、分发和商用，分发时需保留版权声明和许可证文本；软件按原样提供，不作担保。

第三方依赖及其字体、样式等资源遵循各自的许可证。
