<div align="center">

# apiTools

**本地优先的 API 调试台 —— 接口、环境、压测、AI Agent，一个窗口搞定**

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/Lixin-2/apiTools?color=7c5cff)](https://github.com/Lixin-2/apiTools/releases)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey)](#安装)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-24c8db)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.77+-dea584)](https://www.rust-lang.org)

Rust + Tauri 2 驱动，React 界面。
支持 OpenAPI / Swagger / Postman / HAR / cURL 互转，内置 MCP Server，AI Agent 可以直接把接口写进你的项目。

</div>

---

## 为什么用它

| | |
| --- | --- |
| **本地优先** | 数据就是一个 JSON 文件，不登录、不上云、不收集任何统计 |
| **AI 原生** | 内置 MCP Server（HTTP / stdio），Agent 能读项目结构、创建目录、写入接口、发请求验证 |
| **自带压测** | 不用装 JMeter：并发 / 定速 / 随机 TPS、zip 报文池、CSV 变量池、实时图表 |
| **环境即配置** | 每个环境配一次「URL 前缀 + 统一请求头」，接口里只写 `/users`，不用重复填 |

## 功能

**请求调试**

- 7 种方法：`GET` `POST` `PUT` `PATCH` `DELETE` `HEAD` `OPTIONS`
- 请求体：JSON（实时校验 + 格式化）、Text、Form（含文件上传）、URL Encoded
- 鉴权：Bearer / Basic / API Key（header 或 query）
- 编辑器支持折叠、`⌘F` 搜索、语法高亮，上万行 JSON 也不卡

**组织与协作**

- 多项目隔离：一个项目一套集合 / 接口 / 环境，侧栏一键切换
- 集合 → 多级目录（`用户中心/登录`）→ 接口，删除目录时接口自动回到根级
- 请求标签页：切换保留未保存的改动，`⌘W` 关闭、`⌘S` 保存，关闭前自动存盘

**环境**

- 「统一 URL 前缀」+「统一请求头」，发送时自动拼接与注入
- 接口写完整地址时不拼接；接口内同名 Header（忽略大小写）优先于环境
- 请求区、压测面板都能直接切环境

**压测**

- 并发数 / 定时长 / 定请求数 / 逐级加压
- 速率模式：不限速、固定 TPS、随机 TPS（区间 + 变化间隔）
- 报文池：上传 zip，按文件名顺序轮询，每份作为一次请求体
- 变量池：上传 CSV，表头为变量名，按行轮询，用 `${name}` 引用
- 实时图表：QPS、延迟分位、延迟分布、状态码、错误分类、最慢请求
- 后台运行：关掉面板继续跑，右下角常驻状态胶囊，点击回到面板

**导入导出**

- 导入：OpenAPI 3 / Swagger 2、Postman Collection v2.1、HAR、cURL、apiTools JSON（自动识别格式）
- 导出：Postman、OpenAPI 3.0、apiTools JSON
- 响应支持二进制下载，自动识别文件名与 MIME

**外观**

- 浅色（默认）/ 深色 / 跟随系统，配色与 JSON 高亮实时切换
- Dock 图标随主题切换白底 / 黑底
- 侧栏宽度、请求 / 响应分栏高度可拖动，选择会记住
- 全区域右键菜单：请求、目录、集合、标签、编辑器、输入框

## 安装

从 [Releases](https://github.com/Lixin-2/apiTools/releases) 下载：

| 平台 | 文件 |
| --- | --- |
| macOS（Apple Silicon） | `apiTools_x.y.z_aarch64.dmg` |
| Windows（x64） | `apiTools_x.y.z_x64-setup.exe`（推荐）或 `.msi` |

> 未做代码签名：macOS 首次打开需右键 → 打开（或 `xattr -dr com.apple.quarantine /Applications/apiTools.app`）；Windows 首次运行点「更多信息 → 仍要运行」。
> 升级直接装新版覆盖即可，数据保留；Windows 请固定用同一种安装包（exe 或 msi）。

## 快速上手

1. 新建一个集合，在里面建请求，填入 URL（或用环境的相对路径）
2. 右上角「环境设置」配置 URL 前缀和公共请求头，接口里就只写 `/users`
3. 顶部「MCP」开启服务，把配置粘到 Claude / CodeBuddy / Cursor 里，让 Agent 直接管接口

## MCP 集成

应用内提供两种传输方式，右上角 **MCP** 面板可开关、改端口（默认 `4732`），配置可一键复制。

**HTTP（推荐）**

```json
{
  "mcpServers": {
    "apitools": {
      "url": "http://127.0.0.1:4732/mcp"
    }
  }
}
```

**stdio**

```json
{
  "mcpServers": {
    "apitools": {
      "command": "/Applications/apiTools.app/Contents/Resources/binaries/apitools-mcp",
      "args": []
    }
  }
}
```

两种方式共用同一套实现，数据实时同步：Agent 写入的接口会立刻出现在界面里。

此外还有本地 REST API（`http://127.0.0.1:4731`，需带 `x-apitools-token` 头），提供 `/collections`、`/requests`、`/import`、`/export`、`/send`、`/openapi.json` 等端点，方便脚本或第三方工具接入。

<details>
<summary><b>MCP 工具一览（18 个）</b></summary>

| 工具 | 说明 |
| --- | --- |
| `get_project_tree` | 返回项目 → 集合 → 多级目录 → 接口摘要，以及当前环境配置 |
| `list_projects` / `switch_project` / `create_project` | 项目查看、切换、新建 |
| `list_collections` / `create_collection` / `delete_collection` | 集合管理 |
| `create_folder` | 新建目录，`path` 支持多级 |
| `list_requests` / `get_request` / `save_request` / `delete_request` | 接口的增删改查 |
| `import_api_document` / `import_api_from_url` | 导入文档（本地文本或远程 URL） |
| `export_collection` | 导出为 Postman / OpenAPI / JSON |
| `list_environments` / `save_environment` | 环境读取与配置 |
| `send_request` | 代发请求，`applyEnvironment` 可复用环境前缀与请求头 |

</details>

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面壳 | Tauri 2（macOS / Windows） |
| 后端 | Rust 2021：`ureq` HTTP 代理、`axum` 本地 REST、`zip` 报文池、`notify` 文件监听 |
| 前端 | React 18 + TypeScript + Vite（无 UI 框架，手写主题与组件） |
| 编辑器 | CodeMirror 6（折叠 / 搜索 / 语法高亮） |
| Agent | 手写 JSON-RPC，同时支持 HTTP 与 stdio |
| 存储 | 单 JSON 文件 + 文件锁 + 原子写入 |

## 开发

```bash
npm install
npm run dev          # tauri dev（Vite + Rust 热更新）
npm run typecheck    # 前端类型检查
npm run dist         # 打包当前平台（.app/.dmg 或 .exe/.msi）
npm run dist:win     # 打 Windows 包（需在 Windows 或 CI 上执行）
```

依赖：Node.js 18+、Rust 1.77+、平台构建工具链。

**架构**

```
src-tauri/
├── src/lib.rs          # apitools_core：可被桌面应用与 MCP 复用的核心库
│   ├── model.rs        # 数据模型（对齐前端 TS 类型）
│   ├── store.rs        # 读写、文件锁、CRUD
│   ├── importers.rs    # OpenAPI / Postman / HAR / cURL 解析
│   ├── exporters.rs    # Postman / OpenAPI / JSON 导出
│   ├── http_client.rs  # HTTP 代理（含 multipart、文件落盘）
│   ├── load_test.rs    # 压测引擎（并发、限速、报文池、CSV 变量）
│   └── mcp.rs          # MCP 工具实现（两种传输共用）
├── src/main.rs         # Tauri 应用：commands、REST、MCP HTTP 服务
└── src/bin/apitools-mcp.rs   # MCP stdio 二进制

src/shared/             # 前后端共享类型与 URL 工具
src/renderer/           # React 界面（组件、样式、bridge）
```

**数据位置**

```
macOS    ~/Library/Application Support/apiTools/
Windows  %APPDATA%\apiTools\
```

包含 `workspace.json`（项目/集合/接口/环境）、`settings.json`（MCP 端口等）、`api-token`（本地 REST API 令牌）。
可用 `APITOOLS_DATA_DIR` 覆盖数据目录。

## 许可证

[Apache License 2.0](LICENSE) · Copyright 2026 apiTools contributors

允许商用、修改、分发与专利授权；需保留 `LICENSE` 与 `NOTICE`，修改过的文件注明改动。
