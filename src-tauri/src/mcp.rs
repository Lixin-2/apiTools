use crate::{exporters, http_client, importers, model::*, store};
use serde_json::{json, Value};
use std::collections::BTreeMap;

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

fn add_path_with_parents(set: &mut std::collections::BTreeSet<String>, path: &str) {
    let segments: Vec<&str> = path.split('/').filter(|part| !part.trim().is_empty()).collect();
    let mut accumulated = String::new();
    for segment in segments {
        if !accumulated.is_empty() {
            accumulated.push('/');
        }
        accumulated.push_str(segment.trim());
        set.insert(accumulated.clone());
    }
}

fn request_summary(request: &ApiRequest) -> Value {
    json!({
        "id": request.id,
        "method": request.method,
        "name": request.name,
        "url": request.url,
    })
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

pub fn tool_defs() -> Value {
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
            "description": "代理发送一次 HTTP 请求并返回状态码、响应头与响应体。applyEnvironment=true 时会套用当前启用环境的 URL 前缀与统一请求头。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "method": { "type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] },
                    "url": { "type": "string" },
                    "headers": { "type": "object", "additionalProperties": { "type": "string" } },
                    "body": { "type": "string" },
                    "timeoutMs": { "type": "number" },
                    "applyEnvironment": { "type": "boolean", "description": "是否套用环境 URL 前缀与统一请求头，默认 false" }
                },
                "required": ["url"]
            }
        },
        {
            "name": "list_environments",
            "description": "列出 apiTools 中保存的环境（统一 URL 前缀与统一请求头）。",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "list_projects",
            "description": "列出所有项目及当前激活项目。MCP 的其他写操作都作用于当前激活项目。",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "switch_project",
            "description": "切换当前激活项目（后续操作作用于此项目）。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "name": { "type": "string", "description": "项目名称，与 id 二选一" }
                }
            }
        },
        {
            "name": "create_project",
            "description": "新建项目并自动切换为当前项目。",
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
            "name": "get_project_tree",
            "description": "获取当前项目的完整结构：集合、多级目录（含完整路径，如 用户中心/登录）、每个目录下的接口摘要，以及当前环境的 URL 前缀。把新接口写进去之前先调用它，就能确定 save_request 的 collectionName 与 folder 取值。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "includeRequests": { "type": "boolean", "description": "是否包含接口摘要，默认 true" },
                    "collectionName": { "type": "string", "description": "只看某个集合" }
                }
            }
        },
        {
            "name": "create_folder",
            "description": "在集合下创建目录，path 支持多级，例如 用户中心/登录。已存在则忽略。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "collectionId": { "type": "string" },
                    "collectionName": { "type": "string", "description": "与 collectionId 二选一" },
                    "path": { "type": "string", "description": "目录路径，例如 用户中心/登录" }
                },
                "required": ["path"]
            }
        },
        {
            "name": "delete_collection",
            "description": "删除集合及其下所有接口。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "collectionId": { "type": "string" },
                    "collectionName": { "type": "string" }
                }
            }
        },
        {
            "name": "save_environment",
            "description": "创建或更新环境：配置统一 URL 前缀与统一请求头（发送时自动拼接/注入）。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "更新时传入" },
                    "name": { "type": "string", "description": "环境名称，不传 id 时可据此查找" },
                    "baseUrl": { "type": "string", "description": "统一 URL 前缀，例如 https://api.example.com/v1" },
                    "headers": {
                        "type": "object",
                        "additionalProperties": { "type": "string" },
                        "description": "统一请求头，会整体替换已有配置"
                    },
                    "activate": { "type": "boolean", "description": "是否设为当前启用环境，默认 false" }
                }
            }
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
            let Some(mut url) = arg_str(args, "url") else {
                return fail("url 不能为空");
            };
            let method = arg_str(args, "method").unwrap_or_else(|| "GET".to_string());
            let mut headers = arg_map(args, "headers");
            let body = arg_str(args, "body");
            let timeout = arg_u64(args, "timeoutMs");
            let apply_environment = args
                .get("applyEnvironment")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            if apply_environment {
                let ws = store::read_workspace();
                if let Some(env) = ws
                    .active_environment_id
                    .as_ref()
                    .and_then(|id| ws.environments.iter().find(|e| &e.id == id))
                {
                    if !url.starts_with("http://")
                        && !url.starts_with("https://")
                        && !env.base_url.trim().is_empty()
                    {
                        url = format!(
                            "{}/{}",
                            env.base_url.trim().trim_end_matches('/'),
                            url.trim_start_matches('/')
                        );
                    }
                    for header in env.headers.iter() {
                        if header.enabled && !header.key.trim().is_empty() {
                            headers
                                .entry(header.key.clone())
                                .or_insert_with(|| header.value.clone());
                        }
                    }
                }
            }

            let response = http_client::execute(&method, &url, &headers, body.as_deref(), timeout);
            let mut payload = serde_json::to_value(response).unwrap_or_default();
            if let Value::Object(map) = &mut payload {
                map.insert("requestUrl".into(), json!(url));
            }
            text(payload)
        }
        "list_environments" => {
            let ws = store::read_workspace();
            text(serde_json::to_value(ws.environments).unwrap_or_default())
        }
        "list_projects" => {
            let ws = store::read_workspace();
            let items: Vec<Value> = ws
                .projects
                .iter()
                .map(|project| {
                    json!({
                        "id": project.id,
                        "name": project.name,
                        "description": project.description,
                        "collectionCount": project.collection_count,
                        "requestCount": project.request_count,
                        "active": ws.active_project_id.as_deref() == Some(project.id.as_str()),
                    })
                })
                .collect();
            text(json!({
                "projects": items,
                "dataDir": store::data_dir().to_string_lossy()
            }))
        }
        "switch_project" => {
            let ws = store::read_workspace();
            let target = arg_str(args, "id").or_else(|| {
                arg_str(args, "name").and_then(|name| {
                    ws.projects
                        .iter()
                        .find(|project| project.name == name)
                        .map(|project| project.id.clone())
                })
            });
            let Some(id) = target else {
                return fail("请提供项目 id 或 name");
            };
            match store::set_active_project(&id) {
                Ok(_) => {
                    let next = store::read_workspace();
                    let project = next.projects.iter().find(|p| p.id == id);
                    text(json!({
                        "ok": true,
                        "activeProject": project.map(|p| json!({
                            "id": p.id,
                            "name": p.name,
                            "collectionCount": p.collection_count,
                            "requestCount": p.request_count
                        }))
                    }))
                }
                Err(err) => fail(err),
            }
        }
        "create_project" => {
            let Some(name) = arg_str(args, "name") else {
                return fail("name 不能为空");
            };
            let description = arg_str(args, "description").unwrap_or_default();
            match store::create_project(&name, &description) {
                Ok(project) => text(json!({
                    "ok": true,
                    "project": project,
                    "note": "新项目已成为当前项目"
                })),
                Err(err) => fail(err),
            }
        }
        "get_project_tree" => {
            let ws = store::read_workspace();
            let include_requests = args
                .get("includeRequests")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            let only_collection = arg_str(args, "collectionName");

            let project = ws
                .projects
                .iter()
                .find(|p| ws.active_project_id.as_deref() == Some(p.id.as_str()));
            let environment = ws
                .active_environment_id
                .as_ref()
                .and_then(|id| ws.environments.iter().find(|e| &e.id == id))
                .map(|env| {
                    json!({
                        "id": env.id,
                        "name": env.name,
                        "baseUrl": env.base_url,
                        "headers": env
                            .headers
                            .iter()
                            .filter(|h| h.enabled && !h.key.is_empty())
                            .map(|h| json!({ "key": h.key, "value": h.value }))
                            .collect::<Vec<_>>()
                    })
                });

            let mut collections_out: Vec<Value> = Vec::new();
            for collection in ws.collections.iter() {
                if let Some(name) = &only_collection {
                    if &collection.name != name {
                        continue;
                    }
                }
                let mut paths: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
                for folder in collection.folders.iter() {
                    let trimmed = folder.trim();
                    if !trimmed.is_empty() {
                        add_path_with_parents(&mut paths, trimmed);
                    }
                }
                let requests: Vec<&ApiRequest> = ws
                    .requests
                    .iter()
                    .filter(|request| request.collection_id == collection.id)
                    .collect();
                for request in requests.iter() {
                    let trimmed = request.folder.trim();
                    if !trimmed.is_empty() {
                        add_path_with_parents(&mut paths, trimmed);
                    }
                }

                let folders: Vec<Value> = paths
                    .iter()
                    .map(|path| {
                        let matched: Vec<Value> = requests
                            .iter()
                            .filter(|request| request.folder.trim() == path.as_str())
                            .map(|request| request_summary(request))
                            .collect();
                        let count = matched.len();
                        json!({
                            "path": path,
                            "depth": path.matches('/').count(),
                            "requestCount": count,
                            "requests": if include_requests { Value::Array(matched) } else { Value::Array(Vec::new()) }
                        })
                    })
                    .collect();

                let root_requests: Vec<Value> = requests
                    .iter()
                    .filter(|request| request.folder.trim().is_empty())
                    .map(|request| request_summary(request))
                    .collect();

                collections_out.push(json!({
                    "id": collection.id,
                    "name": collection.name,
                    "description": collection.description,
                    "requestCount": requests.len(),
                    "rootRequests": if include_requests { Value::Array(root_requests) } else { Value::Array(Vec::new()) },
                    "folders": folders,
                }));
            }

            text(json!({
                "project": project.map(|p| json!({
                    "id": p.id,
                    "name": p.name,
                    "description": p.description
                })),
                "activeEnvironment": environment,
                "collections": collections_out,
                "hint": "save_request 的 collectionName 用集合 name，folder 用目录 path（多级用 / 分隔）；目录不存在可先调 create_folder"
            }))
        }
        "create_folder" => {
            let ws = store::read_workspace();
            let collection_id = arg_str(args, "collectionId").or_else(|| {
                arg_str(args, "collectionName").and_then(|name| {
                    ws.collections
                        .iter()
                        .find(|collection| collection.name == name)
                        .map(|collection| collection.id.clone())
                })
            });
            let Some(collection_id) = collection_id else {
                return fail("需要 collectionId 或 collectionName");
            };
            let Some(path) = arg_str(args, "path") else {
                return fail("path 不能为空");
            };
            let trimmed = path.trim().trim_matches('/').to_string();
            if trimmed.is_empty() {
                return fail("path 不能为空");
            }
            match store::create_folder(&collection_id, &trimmed) {
                Ok(folders) => text(json!({
                    "ok": true,
                    "collectionId": collection_id,
                    "path": trimmed,
                    "folders": folders
                })),
                Err(err) => fail(err),
            }
        }
        "delete_collection" => {
            let ws = store::read_workspace();
            let id = arg_str(args, "collectionId").or_else(|| {
                arg_str(args, "collectionName").and_then(|name| {
                    ws.collections
                        .iter()
                        .find(|collection| collection.name == name)
                        .map(|collection| collection.id.clone())
                })
            });
            let Some(id) = id else {
                return fail("需要 collectionId 或 collectionName");
            };
            match store::delete_collection(&id) {
                Ok(ok) => text(json!({ "ok": ok })),
                Err(err) => fail(err),
            }
        }
        "save_environment" => {
            let mut payload = serde_json::Map::new();
            if let Some(id) = arg_str(args, "id") {
                payload.insert("id".into(), json!(id));
            }
            if let Some(name) = arg_str(args, "name") {
                if !payload.contains_key("id") {
                    if let Some(existing) = store::read_workspace()
                        .environments
                        .iter()
                        .find(|environment| environment.name == name)
                    {
                        payload.insert("id".into(), json!(existing.id));
                    }
                }
                payload.insert("name".into(), json!(name));
            }
            if let Some(base_url) = arg_str(args, "baseUrl") {
                payload.insert("baseUrl".into(), json!(base_url));
            }
            if args.get("headers").is_some() {
                let headers = arg_map(args, "headers");
                payload.insert(
                    "headers".into(),
                    Value::Array(
                        headers
                            .into_iter()
                            .map(|(key, value)| json!({ "key": key, "value": value, "enabled": true }))
                            .collect(),
                    ),
                );
            }
            match store::save_environment(Value::Object(payload)) {
                Ok(environment) => {
                    let activate = args
                        .get("activate")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    if activate {
                        let _ = store::set_active_environment(Some(environment.id.clone()));
                    }
                    text(serde_json::to_value(environment).unwrap_or_default())
                }
                Err(err) => fail(err),
            }
        }
        other => fail(format!("未知工具: {other}")),
    }
}


/// 处理一条 JSON-RPC 消息，返回需要回写的消息（通知类返回 None）
pub fn handle_message(message: &Value) -> Option<Value> {
    let id = message.get("id").cloned();
    let method = message
        .get("method")
        .and_then(|m| m.as_str())
        .unwrap_or_default()
        .to_string();
    let params = message.get("params").cloned().unwrap_or_else(|| json!({}));

    match method.as_str() {
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
    }
}

pub fn call(name: &str, args: &Value) -> Value {
    call_tool(name, args)
}
