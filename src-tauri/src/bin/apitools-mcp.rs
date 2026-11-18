use apitools_core::{exporters, http_client, importers, model::*, store};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{self, BufRead, Write};

fn arg_str(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

fn arg_u64(args: &Value, key: &str) -> Option<u64> {
    args.get(key).and_then(|v| v.as_u64())
}

fn arg_map(args: &Value, key: &str) -> BTreeMap<String, String> {
    args.get(key)
        .and_then(|v| v.as_object())
        .map(|map| {
            map.iter()
                .filter_map(|(k, v)| {
                    if let Some(text) = v.as_str() {
                        Some((k.clone(), text.to_string()))
                    } else if v.is_null() {
                        None
                    } else {
                        Some((k.clone(), v.to_string()))
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

fn text(value: impl Into<Value>) -> Value {
    let value = value.into();
    let body = match value {
        Value::String(text) => text,
        other => serde_json::to_string_pretty(&other).unwrap_or_default(),
    };
    json!({ "content": [{ "type": "text", "text": body }] })
}

fn fail(message: impl Into<String>) -> Value {
    json!({
        "isError": true,
        "content": [{ "type": "text", "text": message.into() }]
    })
}

fn tool_defs() -> Value {
    json!([
        {
            "name": "import_api_document",
            "description": "将接口文档导入 apiTools 应用（OpenAPI 3 / Swagger 2、Postman Collection v2.1、HAR、cURL 或 apiTools JSON）。格式缺省时自动识别。导入后接口会出现在桌面应用中，可直接调试。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "content": { "type": "string", "description": "接口文档的原始文本（JSON / YAML / cURL 命令）" },
                    "format": { "type": "string", "enum": ["openapi", "postman", "har", "curl", "apitools"], "description": "文档格式，缺省自动识别" },
                    "collectionName": { "type": "string", "description": "自定义集合名称" },
                    "mode": { "type": "string", "enum": ["merge", "replace"], "description": "merge（默认）或 replace" }
                },
                "required": ["content"]
            }
        },
        {
            "name": "import_api_from_url",
            "description": "下载 OpenAPI/Swagger/Postman/HAR 文档并导入 apiTools。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "接口文档 URL" },
                    "collectionName": { "type": "string" },
                    "format": { "type": "string", "enum": ["openapi", "postman", "har", "apitools"] },
                    "mode": { "type": "string", "enum": ["merge", "replace"] }
                },
                "required": ["url"]
            }
        },
        {
            "name": "create_collection",
            "description": "在 apiTools 中创建一个空集合。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "description": { "type": "string" }
                },
                "required": ["name"]
            }
        },
        {
            "name": "list_collections",
            "description": "列出 apiTools 中所有集合及接口数量。",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "list_requests",
            "description": "列出接口，可按集合或关键字过滤。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "collectionId": { "type": "string" },
                    "collectionName": { "type": "string" },
                    "keyword": { "type": "string" }
                }
            }
        },
        {
            "name": "get_request",
            "description": "获取单个接口的完整定义。",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"]
            }
        },
        {
            "name": "save_request",
            "description": "新增或更新单个接口（不传 id 即新建）。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "name": { "type": "string" },
                    "url": { "type": "string" },
                    "method": { "type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] },
                    "collectionName": { "type": "string" },
                    "folder": { "type": "string" },
                    "headers": { "type": "object", "additionalProperties": { "type": "string" } },
                    "params": { "type": "object", "additionalProperties": { "type": "string" } },
                    "bodyType": { "type": "string", "enum": ["none", "json", "text", "form", "urlencoded"] },
                    "body": { "type": "string" },
                    "description": { "type": "string" }
                },
                "required": ["name", "url"]
            }
        },
        {
            "name": "delete_request",
            "description": "按 ID 删除接口。",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"]
            }
        },
        {
            "name": "export_collection",
            "description": "把集合导出为 Postman / OpenAPI / apiTools JSON 文本。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "collectionId": { "type": "string" },
                    "collectionName": { "type": "string" },
                    "format": { "type": "string", "enum": ["postman", "openapi", "apitools"] }
                }
            }
        },
        {
            "name": "send_request",
            "description": "代理发送一次 HTTP 请求并返回状态码、响应头与响应体。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "method": { "type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] },
                    "url": { "type": "string" },
                    "headers": { "type": "object", "additionalProperties": { "type": "string" } },
                    "body": { "type": "string" },
                    "timeoutMs": { "type": "number" }
                },
                "required": ["url"]
            }
        },
        {
            "name": "list_environments",
            "description": "列出 apiTools 中保存的环境（统一 URL 前缀与统一请求头）。",
            "inputSchema": { "type": "object", "properties": {} }
        }
    ])
}

fn call_tool(name: &str, args: &Value) -> Value {
    match name {
        "import_api_document" => {
            let Some(content) = arg_str(args, "content") else {
                return fail("content 不能为空");
            };
            let format = arg_str(args, "format");
            let collection_name = arg_str(args, "collectionName");
            let replace = arg_str(args, "mode").as_deref() == Some("replace");
            let detected = format
                .clone()
                .unwrap_or_else(|| importers::detect_format(&content).to_string());
            match importers::import_content(&content, format.as_deref(), collection_name.as_deref()) {
                Ok(output) => {
                    let names = output
                        .requests
                        .iter()
                        .take(30)
                        .map(|r| format!("{} {}", r.method, r.name))
                        .collect::<Vec<_>>();
                    let mut warnings = output.warnings.clone();
                    match store::apply_import(
                        &output.collection_name,
                        output.requests,
                        &output.description,
                        replace,
                    ) {
                        Ok(result) => {
                            warnings.extend(result.warnings.clone());
                            text(json!({
                                "ok": true,
                                "format": detected,
                                "collection": result.collection.name,
                                "collectionId": result.collection.id,
                                "imported": result.imported,
                                "skipped": result.skipped,
                                "warnings": warnings,
                                "sampleRequests": names,
                                "dataDir": store::data_dir().to_string_lossy()
                            }))
                        }
                        Err(err) => fail(format!("写入失败：{err}")),
                    }
                }
                Err(err) => fail(format!("导入失败：{err}")),
            }
        }
        "import_api_from_url" => {
            let Some(url) = arg_str(args, "url") else {
                return fail("url 不能为空");
            };
            let agent = ureq::AgentBuilder::new()
                .timeout(std::time::Duration::from_secs(30))
                .build();
            match agent.get(&url).call() {
                Ok(resp) => match resp.into_string() {
                    Ok(content) => {
                        let format = arg_str(args, "format");
                        let collection_name = arg_str(args, "collectionName");
                        let replace = arg_str(args, "mode").as_deref() == Some("replace");
                        let detected = format
                            .clone()
                            .unwrap_or_else(|| importers::detect_format(&content).to_string());
                        match importers::import_content(
                            &content,
                            format.as_deref(),
                            collection_name.as_deref(),
                        ) {
                            Ok(output) => match store::apply_import(
                                &output.collection_name,
                                output.requests,
                                &output.description,
                                replace,
                            ) {
                                Ok(result) => text(json!({
                                    "ok": true,
                                    "sourceUrl": url,
                                    "format": detected,
                                    "collection": result.collection.name,
                                    "collectionId": result.collection.id,
                                    "imported": result.imported,
                                    "skipped": result.skipped,
                                    "warnings": result.warnings
                                })),
                                Err(err) => fail(format!("写入失败：{err}")),
                            },
                            Err(err) => fail(format!("解析失败：{err}")),
                        }
                    }
                    Err(err) => fail(format!("读取响应失败：{err}")),
                },
                Err(err) => fail(format!("下载失败：{err}")),
            }
        }
        "create_collection" => {
            let Some(name) = arg_str(args, "name") else {
                return fail("name 不能为空");
            };
            let description = arg_str(args, "description").unwrap_or_default();
            match store::create_collection(&name, &description) {
                Ok(collection) => text(serde_json::to_value(collection).unwrap_or_default()),
                Err(err) => fail(err),
            }
        }
        "list_collections" => {
            let ws = store::read_workspace();
            let collections: Vec<Value> = ws
                .collections
                .iter()
                .map(|c| {
                    json!({
                        "id": c.id,
                        "name": c.name,
                        "description": c.description,
                        "requestCount": ws.requests.iter().filter(|r| r.collection_id == c.id).count()
                    })
                })
                .collect();
            text(json!({
                "dataDir": store::data_dir().to_string_lossy(),
                "collections": collections
            }))
        }
        "list_requests" => {
            let ws = store::read_workspace();
            let collection_id = arg_str(args, "collectionId");
            let collection_name = arg_str(args, "collectionName");
            let keyword = arg_str(args, "keyword").map(|k| k.to_lowercase());
            let target_id = collection_id.or_else(|| {
                collection_name.and_then(|name| {
                    ws.collections
                        .iter()
                        .find(|c| c.name == name)
                        .map(|c| c.id.clone())
                })
            });
            let items: Vec<Value> = ws
                .requests
                .iter()
                .filter(|r| match &target_id {
                    Some(id) => &r.collection_id == id,
                    None => true,
                })
                .filter(|r| match &keyword {
                    Some(k) => format!("{} {}", r.name, r.url).to_lowercase().contains(k),
                    None => true,
                })
                .map(|r| {
                    json!({
                        "id": r.id,
                        "collection": ws.collections.iter().find(|c| c.id == r.collection_id).map(|c| c.name.clone()).unwrap_or_default(),
                        "folder": r.folder,
                        "name": r.name,
                        "method": r.method,
                        "url": r.url
                    })
                })
                .collect();
            text(Value::Array(items))
        }
        "get_request" => {
            let Some(id) = arg_str(args, "id") else {
                return fail("id 不能为空");
            };
            match store::get_request(&id) {
                Some(request) => text(serde_json::to_value(request).unwrap_or_default()),
                None => fail("接口不存在"),
            }
        }
        "save_request" => {
            let Some(name) = arg_str(args, "name") else {
                return fail("name 不能为空");
            };
            let Some(url) = arg_str(args, "url") else {
                return fail("url 不能为空");
            };
            let mut input = serde_json::Map::new();
            input.insert("name".into(), json!(name));
            input.insert("url".into(), json!(url));
            for key in ["id", "method", "collectionName", "folder", "bodyType", "body", "description"] {
                if let Some(value) = arg_str(args, key) {
                    input.insert(key.into(), json!(value));
                }
            }
            let headers = arg_map(args, "headers");
            if !headers.is_empty() {
                input.insert(
                    "headers".into(),
                    Value::Array(
                        headers
                            .into_iter()
                            .map(|(k, v)| json!({ "key": k, "value": v, "enabled": true }))
                            .collect(),
                    ),
                );
            }
            let params = arg_map(args, "params");
            if !params.is_empty() {
                input.insert(
                    "params".into(),
                    Value::Array(
                        params
                            .into_iter()
                            .map(|(k, v)| json!({ "key": k, "value": v, "enabled": true }))
                            .collect(),
                    ),
                );
            }
            match store::upsert_request(Value::Object(input)) {
                Ok(request) => text(serde_json::to_value(request).unwrap_or_default()),
                Err(err) => fail(err),
            }
        }
        "delete_request" => {
            let Some(id) = arg_str(args, "id") else {
                return fail("id 不能为空");
            };
            match store::delete_request(&id) {
                Ok(ok) => text(json!({ "ok": ok })),
                Err(err) => fail(err),
            }
        }
        "export_collection" => {
            let ws = store::read_workspace();
            let collection = arg_str(args, "collectionId")
                .and_then(|id| ws.collections.iter().find(|c| c.id == id).cloned())
                .or_else(|| {
                    arg_str(args, "collectionName")
                        .and_then(|name| ws.collections.iter().find(|c| c.name == name).cloned())
                })
                .or_else(|| ws.collections.first().cloned());
            let Some(collection) = collection else {
                return fail("集合不存在");
            };
            let requests: Vec<ApiRequest> = ws
                .requests
                .into_iter()
                .filter(|r| r.collection_id == collection.id)
                .collect();
            let format = arg_str(args, "format").unwrap_or_else(|| "postman".to_string());
            let output = exporters::export_collection(&collection, &requests, &format);
            text(output.content)
        }
        "send_request" => {
            let Some(url) = arg_str(args, "url") else {
                return fail("url 不能为空");
            };
            let method = arg_str(args, "method").unwrap_or_else(|| "GET".to_string());
            let headers = arg_map(args, "headers");
            let body = arg_str(args, "body");
            let timeout = arg_u64(args, "timeoutMs");
            let response = http_client::execute(&method, &url, &headers, body.as_deref(), timeout);
            text(serde_json::to_value(response).unwrap_or_default())
        }
        "list_environments" => {
            let ws = store::read_workspace();
            text(serde_json::to_value(ws.environments).unwrap_or_default())
        }
        other => fail(format!("未知工具: {other}")),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut index = 1;
    while index < args.len() {
        if args[index] == "--data-dir" && index + 1 < args.len() {
            std::env::set_var("APITOOLS_DATA_DIR", &args[index + 1]);
            index += 2;
            continue;
        }
        index += 1;
    }

    let stdin = io::stdin();
    let mut stdout = io::stdout();
    eprintln!(
        "[apitools-mcp] ready (rust). data dir: {}",
        store::data_dir().to_string_lossy()
    );

    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let id = message.get("id").cloned();
        let method = message
            .get("method")
            .and_then(|m| m.as_str())
            .unwrap_or_default()
            .to_string();
        let params = message.get("params").cloned().unwrap_or_else(|| json!({}));

        let response = match method.as_str() {
            "initialize" => Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": { "tools": {} },
                    "serverInfo": { "name": "apitools", "version": env!("CARGO_PKG_VERSION") }
                }
            })),
            "notifications/initialized" | "notifications/cancelled" => None,
            "ping" => Some(json!({ "jsonrpc": "2.0", "id": id, "result": {} })),
            "tools/list" => Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "tools": tool_defs() }
            })),
            "tools/call" => {
                let name = params
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or_default()
                    .to_string();
                let arguments = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
                let result = call_tool(&name, &arguments);
                Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
            }
            _ => {
                if id.is_some() {
                    Some(json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": -32601, "message": format!("Method not found: {method}") }
                    }))
                } else {
                    None
                }
            }
        };

        if let Some(response) = response {
            if writeln!(stdout, "{response}").is_err() {
                break;
            }
            let _ = stdout.flush();
        }
    }
}
