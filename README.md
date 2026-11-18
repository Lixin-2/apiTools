# apiTools

本地优先的 REST API 调试台（macOS 桌面应用）。**Rust + Tauri 2** 实现后端与桌面壳，React + TypeScript 实现界面，参考 Hoppscotch 的工作流：左侧集合树、中间请求编辑、下方响应面板。

支持 OpenAPI / Postman / HAR / cURL 导入导出，内置 **MCP Server** 与 **本地 REST API**，AI agent 可以把接口直接写进你的工作区。

## 功能

- **多项目管理**：按项目隔离集合、接口与环境，侧栏顶部一键切换
- **请求调试**：GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS；参数、请求头、请求体（JSON / Text / Form / URL Encoded）；Bearer / Basic / API Key 鉴权
- **集合与目录**：集合 → 目录 → 接口；目录支持空目录、重命名、删除（删除目录时接口回到根级）
- **目录级配置**：给目录配置变量与公共请求头，目录内接口自动继承（请求内同名 Header 优先）
- **变量补全**：在 URL / 参数 / 请求头 / 请求体 / 鉴权字段输入 `{{` 即可弹出候选，↑↓ 选择、Enter 插入
- **环境变量**：`{{变量}}` 实时预览解析结果，未定义变量会高亮提示（导入相对 `servers` 的 OpenAPI 时自动生成 `{{baseUrl}}`）
- **主题与布局**：夜间 / 浅色模式切换；侧栏宽度、请求/响应分栏高度均可拖动，选择会记住
- **导入**：OpenAPI 3 / Swagger 2、Postman Collection v2.1、HAR、cURL、apiTools JSON（自动识别格式）
- **导出**：Postman Collection v2.1、OpenAPI 3.0、apiTools JSON（可复制或保存文件）
- **MCP**：agent 通过 MCP 工具导入接口、查询集合、导出文档、直接发请求验证
- **本地 REST API**：所有数据操作都有 HTTP 端点，方便脚本或第三方工具接入

## 技术栈

| 层 | 选型 |
| --- | --- |
| 语言 | Rust 2021（1.77+） |
| 桌面壳 | Tauri 2（macOS，Overlay 标题栏） |
| 界面 | React 18 + TypeScript + Vite（手写深色主题，无 UI 框架） |
| 本地服务 | `axum` 0.7 + tokio，监听 `127.0.0.1:4731`，Token 鉴权 |
| HTTP 代理 | `ureq` 2（rustls） |
| 序列化 | `serde` / `serde_json` |
| 文件监听 | `notify` 6（MCP 写入实时同步到界面） |
| Agent 接入 | 手写 JSON-RPC over stdio（无额外依赖） |
| 存储 | 单个 JSON 文件 + 文件锁 + 原子写入 |
| 打包 | Tauri bundler（.app + .dmg，arm64） |

## 架构

```
src-tauri/
├── src/lib.rs            # 核心库 apitools_core（不含 tauri，可被 MCP 复用）
│   ├── model.rs          # 数据模型（serde camelCase，对齐前端 TS 类型）
│   ├── store.rs          # 工作区读写、文件锁、集合/接口/环境 CRUD
│   ├── importers.rs      # OpenAPI / Postman / HAR / cURL 解析
│   ├── exporters.rs      # Postman / OpenAPI / apiTools 导出
│   └── http_client.rs    # ureq 请求代理，返回状态码/头/耗时
├── src/main.rs           # Tauri 应用：commands、REST 服务、文件监听
├── src/rest.rs           # axum 路由（本地 REST API）
└── src/bin/apitools-mcp.rs  # MCP stdio server（独立二进制）
```

同一份 `apitools_core` 同时被桌面应用和 MCP 二进制复用，两者读写同一个 JSON 数据文件，因此 agent 导入的接口会立刻出现在应用界面里。

## 数据位置

```
~/Library/Application Support/apiTools/workspace.json   # 项目、集合、目录、接口、环境与变量
~/Library/Application Support/apiTools/api-token        # 本地 REST API Token
```

可用环境变量 `APITOOLS_DATA_DIR` 覆盖数据目录（MCP 也支持 `--data-dir <path>`）。

## 开发

需要：Node.js 18+、Rust 1.77+、Xcode Command Line Tools。

```bash
npm install
npm run dev          # tauri dev：Vite + Rust 热更新
npm run typecheck    # 前端类型检查
npm run build:mcp    # 单独编译 MCP 二进制 → src-tauri/binaries/apitools-mcp
npm run dist         # 打包 macOS 应用（.app + .dmg）
```

## 打包产物

```bash
npm run dist
```

输出：

```
src-tauri/target/aarch64-apple-darwin/release/bundle/macos/apiTools.app
src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/apiTools_1.0.0_aarch64.dmg
```

应用为 ad-hoc 签名（无开发者证书）。首次打开若被 Gatekeeper 拦截，右键点击 → 打开，或执行：

```bash
xattr -dr com.apple.quarantine /Applications/apiTools.app
```

MCP Server 随应用分发：`apiTools.app/Contents/Resources/binaries/apitools-mcp`，无需额外安装运行时。

## MCP 接入

在 Claude Desktop / CodeBuddy / Cursor 的 MCP 配置中添加：

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

应用内点击右上角 **MCP** 按钮可一键复制该配置（路径按实际安装位置生成）。

### MCP 工具

| 工具 | 说明 |
| --- | --- |
| `import_api_document` | 传入 OpenAPI / Postman / HAR / cURL 原文并入库（自动识别格式） |
| `import_api_from_url` | 从远程 URL 拉取接口文档并导入 |
| `create_collection` / `list_collections` | 创建、列出集合 |
| `list_requests` / `get_request` | 浏览接口 |
| `save_request` / `delete_request` | 维护单个接口 |
| `export_collection` | 导出为 Postman / OpenAPI / apiTools |
| `send_request` | 代理发送请求，返回状态码与响应 |
| `list_environments` | 查看环境变量 |

示例：对 agent 说「把 https://petstore3.swagger.io/api/v3/openapi.json 的接口导入 apiTools」，agent 调用 `import_api_from_url` 后接口立即出现在应用里。

## 本地 REST API

所有请求需带 `x-apitools-token` 头（Token 见应用内 MCP 面板或 `api-token` 文件）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| GET / POST | `/collections` | 列出 / 创建集合 |
| PATCH / DELETE | `/collections/:id` | 更新 / 删除集合 |
| GET / POST | `/requests` | 列出 / 创建接口 |
| PUT / DELETE | `/requests/:id` | 更新 / 删除接口 |
| POST | `/import` | 导入文档（`{content, format?, collectionName?, mode?}`） |
| GET | `/export` | 导出集合（`?format=postman&collectionId=...`） |
| POST | `/send` | 代理发送 HTTP 请求 |
| GET | `/openapi.json` | 自身 API 的 OpenAPI 描述 |

```bash
TOKEN=$(cat ~/Library/Application\ Support/apiTools/api-token)
curl -X POST http://127.0.0.1:4731/import \
  -H "content-type: application/json" \
  -H "x-apitools-token: $TOKEN" \
  -d '{"format":"openapi","content":"{\"openapi\":\"3.0.0\",...}"}'
```

## 目录结构

```
src-tauri/         Rust：核心库、Tauri 应用、REST 服务、MCP 二进制
src/shared/        前端共享类型（TS）与 URL 工具
src/renderer/      React 界面（组件、样式、Tauri bridge）
scripts/           构建脚本（编译并复制 MCP 二进制）
```
