# binaries

该目录用于存放随应用分发的 MCP Server 二进制。

- `apitools-mcp` 由 `npm run build:mcp`（或 `npm run dist`）自动编译并复制到这里，不进版本库。
- 打包后位于 `apiTools.app/Contents/Resources/binaries/apitools-mcp`，可被 Claude Desktop / CodeBuddy / Cursor 直接作为 MCP stdio 服务启动。
