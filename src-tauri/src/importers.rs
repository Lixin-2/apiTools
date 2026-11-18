use crate::model::*;
use serde_json::Value;

pub fn detect_format(content: &str) -> &'static str {
    let text = content.trim();
    if text.is_empty() {
        return "apitools";
    }
    if text.starts_with("curl") || text.starts_with("curl.exe") {
        return "curl";
    }
    if let Ok(json) = serde_json::from_str::<Value>(text) {
        if json.get("info").is_some() && json.get("item").is_some() {
            return "postman";
        }
        if json.get("openapi").is_some() || json.get("swagger").is_some() {
            return "openapi";
        }
        if json.get("log").and_then(|l| l.get("entries")).map(|e| e.is_array()).unwrap_or(false) {
            return "har";
        }
        if json.get("version").is_some() && json.get("collections").is_some() {
            return "apitools";
        }
    }
    "openapi"
}

fn s(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}

fn kv_pairs(value: &Value) -> Vec<KeyValue> {
    value
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter(|item| !item.get("disabled").and_then(|d| d.as_bool()).unwrap_or(false))
                .filter_map(|item| {
                    let key = s(item, "key");
                    if key.is_empty() {
                        return None;
                    }
                    let value = item
                        .get("value")
                        .map(|v| {
                            if let Some(text) = v.as_str() {
                                text.to_string()
                            } else {
                                v.to_string()
                            }
                        })
                        .unwrap_or_default();
                    Some(KeyValue::new(key, value))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = &input[i + 1..i + 3];
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            out.push(b' ');
        } else {
            out.push(bytes[i]);
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn split_query(raw: &str) -> (String, Vec<KeyValue>) {
    let input = raw.trim();
    let mut base = input.to_string();
    let mut params = Vec::new();
    if let Some(index) = input.find('?') {
        base = input[..index].to_string();
        let query = &input[index + 1..];
        let query = query.split('#').next().unwrap_or(query);
        for part in query.split('&') {
            if part.is_empty() {
                continue;
            }
            let (key, value) = match part.find('=') {
                Some(eq) => (&part[..eq], &part[eq + 1..]),
                None => (part, ""),
            };
            params.push(KeyValue::new(percent_decode(key), percent_decode(value)));
        }
    }
    (base, params)
}

/* ---------------------------------- openapi -------------------------------- */

fn schema_example(schema: &Value, depth: usize) -> Value {
    if depth > 6 {
        return Value::Null;
    }
    if let Some(example) = schema.get("example") {
        return example.clone();
    }
    if let Some(default) = schema.get("default") {
        return default.clone();
    }
    if let Some(first) = schema
        .get("enum")
        .and_then(|e| e.as_array())
        .and_then(|arr| arr.first())
    {
        return first.clone();
    }
    if let Some(composed) = schema
        .get("allOf")
        .or_else(|| schema.get("oneOf"))
        .or_else(|| schema.get("anyOf"))
        .and_then(|v| v.as_array())
    {
        let mut merged = serde_json::Map::new();
        for item in composed {
            if let Value::Object(map) = schema_example(item, depth + 1) {
                for (key, value) in map {
                    merged.insert(key, value);
                }
            }
        }
        return Value::Object(merged);
    }
    match schema.get("type").and_then(|t| t.as_str()).unwrap_or("") {
        "object" => {
            let mut map = serde_json::Map::new();
            if let Some(props) = schema.get("properties").and_then(|p| p.as_object()) {
                for (key, value) in props {
                    map.insert(key.clone(), schema_example(value, depth + 1));
                }
            }
            Value::Object(map)
        }
        "array" => Value::Array(vec![schema
            .get("items")
            .map(|item| schema_example(item, depth + 1))
            .unwrap_or(Value::Null)]),
        "integer" | "number" => Value::from(0),
        "boolean" => Value::from(true),
        "string" => Value::from(""),
        _ => Value::Object(serde_json::Map::new()),
    }
}

static NULL_VALUE: Value = Value::Null;

fn resolve_ref<'a>(spec: &'a Value, reference: &str) -> &'a Value {
    if !reference.starts_with("#/") {
        return &NULL_VALUE;
    }
    let mut current = spec;
    for part in reference[2..].split('/') {
        let clean = part.replace("~1", "/").replace("~0", "~");
        match current.get(&clean) {
            Some(next) => current = next,
            None => return &NULL_VALUE,
        }
    }
    current
}

pub fn import_openapi(content: &str) -> Result<ImportOutput, String> {
    let spec: Value = serde_json::from_str(content).map_err(|e| format!("OpenAPI 解析失败: {e}"))?;
    let mut warnings = Vec::new();
    let base_url = spec
        .get("servers")
        .and_then(|s| s.as_array())
        .and_then(|arr| arr.first())
        .map(|server| s(server, "url"))
        .filter(|url| !url.is_empty())
        .or_else(|| {
            let host = s(&spec, "host");
            if host.is_empty() {
                None
            } else {
                let scheme = spec
                    .get("schemes")
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|v| v.as_str())
                    .unwrap_or("https");
                Some(format!("{scheme}://{host}{}", s(&spec, "basePath")))
            }
        })
        .unwrap_or_default();

    let mut requests = Vec::new();
    let methods = ["get", "post", "put", "patch", "delete", "head", "options"];
    if let Some(paths) = spec.get("paths").and_then(|p| p.as_object()) {
        for (path, path_item) in paths {
            let mut global_params: Vec<Value> = Vec::new();
            if let Some(list) = path_item.get("parameters").and_then(|p| p.as_array()) {
                for param in list {
                    global_params.push(match param.get("$ref").and_then(|r| r.as_str()) {
                        Some(reference) => resolve_ref(&spec, reference).clone(),
                        None => param.clone(),
                    });
                }
            }
            for method in methods {
                let Some(operation) = path_item.get(method) else {
                    continue;
                };
                let mut params: Vec<KeyValue> = Vec::new();
                let mut headers: Vec<KeyValue> = Vec::new();
                let mut all_params = global_params.clone();
                if let Some(list) = operation.get("parameters").and_then(|p| p.as_array()) {
                    for param in list {
                        all_params.push(match param.get("$ref").and_then(|r| r.as_str()) {
                            Some(reference) => resolve_ref(&spec, reference).clone(),
                            None => param.clone(),
                        });
                    }
                }
                for param in &all_params {
                    let name = s(param, "name");
                    if name.is_empty() {
                        continue;
                    }
                    let location = s(param, "in");
                    let example = param
                        .get("example")
                        .cloned()
                        .or_else(|| param.get("schema").and_then(|sc| sc.get("example")).cloned())
                        .or_else(|| {
                            param
                                .get("schema")
                                .and_then(|sc| sc.get("enum"))
                                .and_then(|e| e.as_array())
                                .and_then(|arr| arr.first())
                                .cloned()
                        })
                        .map(|v| match v.as_str() {
                            Some(text) => text.to_string(),
                            None => v.to_string(),
                        })
                        .unwrap_or_else(|| {
                            if param.get("required").and_then(|r| r.as_bool()).unwrap_or(false) {
                                format!("<{name}>")
                            } else {
                                String::new()
                            }
                        });
                    if location == "query" {
                        params.push(KeyValue::new(name, example));
                    } else if location == "header" {
                        headers.push(KeyValue::new(name, example));
                    }
                }

                let mut body_type = "none".to_string();
                let mut body = String::new();
                let request_body = operation
                    .get("requestBody")
                    .map(|rb| match rb.get("$ref").and_then(|r| r.as_str()) {
                        Some(reference) => resolve_ref(&spec, reference).clone(),
                        None => rb.clone(),
                    });
                if let Some(content_map) = request_body.as_ref().and_then(|rb| rb.get("content")) {
                    if let Some(json_content) = content_map.get("application/json") {
                        let schema = json_content
                            .get("schema")
                            .cloned()
                            .unwrap_or(Value::Object(Default::default()));
                        body_type = "json".to_string();
                        body = serde_json::to_string_pretty(&schema_example(&schema, 0))
                            .unwrap_or_else(|_| "{}".to_string());
                    } else if let Some(form) = content_map.get("application/x-www-form-urlencoded") {
                        body_type = "urlencoded".to_string();
                        body = form
                            .get("schema")
                            .and_then(|sc| sc.get("properties"))
                            .and_then(|p| p.as_object())
                            .map(|props| {
                                props
                                    .keys()
                                    .map(|k| format!("{k}="))
                                    .collect::<Vec<_>>()
                                    .join("&")
                            })
                            .unwrap_or_default();
                    } else if let Some(form) = content_map.get("multipart/form-data") {
                        body_type = "form".to_string();
                        body = form
                            .get("schema")
                            .and_then(|sc| sc.get("properties"))
                            .and_then(|p| p.as_object())
                            .map(|props| {
                                props
                                    .keys()
                                    .map(|k| format!("{k}="))
                                    .collect::<Vec<_>>()
                                    .join("&")
                            })
                            .unwrap_or_default();
                    } else if let Some(first) = content_map.as_object().and_then(|m| m.values().next()) {
                        body_type = "text".to_string();
                        body = first
                            .get("example")
                            .map(|v| match v.as_str() {
                                Some(text) => text.to_string(),
                                None => v.to_string(),
                            })
                            .unwrap_or_default();
                    }
                }

                let tags = operation
                    .get("tags")
                    .and_then(|t| t.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|t| t.as_str())
                    .unwrap_or("");

                let name = {
                    let summary = s(operation, "summary");
                    if !summary.is_empty() {
                        summary
                    } else {
                        let op_id = s(operation, "operationId");
                        if !op_id.is_empty() {
                            op_id
                        } else {
                            format!("{} {}", method.to_uppercase(), path)
                        }
                    }
                };

                // servers 为绝对地址时拼接完整 URL；为相对路径（如 /api/v3）时保留相对形式，
                // 交给「环境」里的统一 URL 前缀在发送时补全
                let url = format!("{}{}", base_url.trim_end_matches('/'), path);

                requests.push(ApiRequest {
                    name,
                    method: method.to_uppercase(),
                    url,
                    params,
                    headers,
                    body_type,
                    body,
                    description: {
                        let desc = s(operation, "description");
                        if desc.is_empty() {
                            s(operation, "summary")
                        } else {
                            desc
                        }
                    },
                    folder: tags.to_string(),
                    ..Default::default()
                });
            }
        }
    }

    if requests.is_empty() {
        warnings.push("OpenAPI 文档中没有找到接口定义".to_string());
    }

    let title = spec
        .get("info")
        .map(|info| {
            let t = s(info, "title");
            if t.is_empty() {
                "OpenAPI 导入".to_string()
            } else {
                t
            }
        })
        .unwrap_or_else(|| "OpenAPI 导入".to_string());

    Ok(ImportOutput {
        collection_name: title.chars().take(60).collect(),
        description: spec
            .get("info")
            .map(|info| s(info, "description"))
            .unwrap_or_default(),
        requests,
        warnings,
    })
}

/* ---------------------------------- postman -------------------------------- */

fn walk_postman(items: &Value, folder: &str, out: &mut Vec<ApiRequest>) {
    let Some(list) = items.as_array() else {
        return;
    };
    for item in list {
        if let Some(children) = item.get("item").and_then(|c| c.as_array()) {
            let name = s(item, "name");
            let next_folder = if name.is_empty() {
                folder.to_string()
            } else if folder.is_empty() {
                name
            } else {
                format!("{folder}/{name}")
            };
            walk_postman(&Value::Array(children.clone()), &next_folder, out);
            continue;
        }
        let Some(request) = item.get("request") else {
            continue;
        };
        let raw_url = match request.get("url") {
            Some(Value::String(text)) => text.clone(),
            Some(url) => s(url, "raw"),
            None => String::new(),
        };
        let (url, mut params) = split_query(&raw_url);
        let headers: Vec<KeyValue> = request.get("header").map(kv_pairs).unwrap_or_default();
        if let Some(Value::Object(url_obj)) = request.get("url") {
            if let Some(query) = url_obj.get("query").and_then(|q| q.as_array()) {
                for q in query {
                    if q.get("disabled").and_then(|d| d.as_bool()).unwrap_or(false) {
                        continue;
                    }
                    let key = s(q, "key");
                    if key.is_empty() || params.iter().any(|p| p.key == key) {
                        continue;
                    }
                    params.push(KeyValue::new(key, s(q, "value")));
                }
            }
        }

        let mut body_type = "none".to_string();
        let mut body = String::new();
        if let Some(post_body) = request.get("body") {
            match s(post_body, "mode").as_str() {
                "raw" => {
                    body = s(post_body, "raw");
                    let lang = post_body
                        .get("options")
                        .and_then(|o| o.get("raw"))
                        .and_then(|r| r.get("language"))
                        .and_then(|l| l.as_str())
                        .unwrap_or("");
                    body_type = if lang == "json" { "json" } else { "text" }.to_string();
                }
                "urlencoded" => {
                    body_type = "urlencoded".to_string();
                    body = post_body
                        .get("urlencoded")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter(|p| !p.get("disabled").and_then(|d| d.as_bool()).unwrap_or(false))
                                .map(|p| format!("{}={}", s(p, "key"), s(p, "value")))
                                .collect::<Vec<_>>()
                                .join("&")
                        })
                        .unwrap_or_default();
                }
                "formdata" => {
                    body_type = "form".to_string();
                    body = post_body
                        .get("formdata")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter(|p| !p.get("disabled").and_then(|d| d.as_bool()).unwrap_or(false))
                                .map(|p| format!("{}={}", s(p, "key"), s(p, "value")))
                                .collect::<Vec<_>>()
                                .join("&")
                        })
                        .unwrap_or_default();
                }
                "graphql" => {
                    body_type = "json".to_string();
                    body = serde_json::to_string_pretty(&serde_json::json!({
                        "query": post_body.get("graphql").map(|g| s(g, "query")).unwrap_or_default(),
                        "variables": {}
                    }))
                    .unwrap_or_default();
                }
                _ => {}
            }
        }

        let mut auth = AuthConfig::default();
        if let Some(auth_obj) = request.get("auth") {
            match s(auth_obj, "type").as_str() {
                "bearer" => {
                    auth.kind = "bearer".to_string();
                    auth.token = auth_obj
                        .get("bearer")
                        .and_then(|v| v.as_array())
                        .and_then(|arr| arr.first())
                        .map(|v| s(v, "value"));
                }
                "basic" => {
                    auth.kind = "basic".to_string();
                    auth.username = auth_obj
                        .get("basic")
                        .and_then(|v| v.as_array())
                        .and_then(|arr| arr.first())
                        .map(|v| s(v, "value"));
                    auth.password = auth_obj
                        .get("basic")
                        .and_then(|v| v.as_array())
                        .and_then(|arr| arr.get(1))
                        .map(|v| s(v, "value"));
                }
                "apikey" => {
                    auth.kind = "apikey".to_string();
                    auth.key = auth_obj
                        .get("apikey")
                        .and_then(|v| v.as_array())
                        .and_then(|arr| arr.first())
                        .map(|v| s(v, "value"));
                    auth.value = auth_obj
                        .get("apikey")
                        .and_then(|v| v.as_array())
                        .and_then(|arr| arr.get(1))
                        .map(|v| s(v, "value"));
                    auth.add_to = auth_obj
                        .get("apikey")
                        .and_then(|v| v.as_array())
                        .and_then(|arr| arr.get(2))
                        .map(|v| {
                            if s(v, "value") == "query" {
                                "query".to_string()
                            } else {
                                "header".to_string()
                            }
                        });
                }
                _ => {}
            }
        }

        let description = match request.get("description") {
            Some(Value::String(text)) => text.clone(),
            Some(value) => s(value, "content"),
            None => String::new(),
        };

        out.push(ApiRequest {
            name: s(item, "name"),
            method: {
                let method = s(request, "method");
                if method.is_empty() {
                    "GET".to_string()
                } else {
                    method.to_uppercase()
                }
            },
            url,
            params,
            headers,
            body_type,
            body,
            folder: folder.to_string(),
            auth,
            description,
            ..Default::default()
        });
    }
}

pub fn import_postman(content: &str) -> Result<ImportOutput, String> {
    let json: Value = serde_json::from_str(content).map_err(|e| format!("Postman 解析失败: {e}"))?;
    let mut requests = Vec::new();
    if let Some(item) = json.get("item") {
        walk_postman(item, "", &mut requests);
    }
    let mut warnings = Vec::new();
    if requests.is_empty() {
        warnings.push("Postman 集合中没有找到请求".to_string());
    }
    let name = json
        .get("info")
        .map(|info| {
            let n = s(info, "name");
            if n.is_empty() {
                "Postman 导入".to_string()
            } else {
                n
            }
        })
        .unwrap_or_else(|| "Postman 导入".to_string());
    let description = json
        .get("info")
        .map(|info| s(info, "description"))
        .unwrap_or_default();
    Ok(ImportOutput {
        collection_name: name,
        description,
        requests,
        warnings,
    })
}

/* ------------------------------------ har ---------------------------------- */

pub fn import_har(content: &str) -> Result<ImportOutput, String> {
    let json: Value = serde_json::from_str(content).map_err(|e| format!("HAR 解析失败: {e}"))?;
    let mut requests = Vec::new();
    if let Some(entries) = json
        .get("log")
        .and_then(|l| l.get("entries"))
        .and_then(|e| e.as_array())
    {
        for entry in entries {
            let Some(request) = entry.get("request") else {
                continue;
            };
            let raw_url = s(request, "url");
            if raw_url.is_empty() {
                continue;
            }
            let (url, params) = split_query(&raw_url);
            let headers: Vec<KeyValue> = request
                .get("headers")
                .and_then(|h| h.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter(|h| {
                            let name = s(h, "name").to_lowercase();
                            !matches!(name.as_str(), "content-length" | "host" | "cookie")
                        })
                        .map(|h| KeyValue::new(s(h, "name"), s(h, "value")))
                        .collect()
                })
                .unwrap_or_default();
            let path = raw_url
                .split("://")
                .nth(1)
                .and_then(|rest| rest.find('/').map(|i| rest[i..].to_string()))
                .unwrap_or_else(|| raw_url.clone());
            let mut req = ApiRequest {
                name: format!("{} {}", s(request, "method").to_uppercase(), path),
                method: s(request, "method").to_uppercase(),
                url,
                params,
                headers,
                ..Default::default()
            };
            if let Some(text) = request
                .get("postData")
                .and_then(|p| p.get("text"))
                .and_then(|t| t.as_str())
            {
                let mime = request
                    .get("postData")
                    .map(|p| s(p, "mimeType"))
                    .unwrap_or_default();
                let is_json = mime.to_lowercase().contains("json")
                    || text.trim_start().starts_with('{')
                    || text.trim_start().starts_with('[');
                req.body_type = if is_json { "json" } else { "text" }.to_string();
                req.body = text.to_string();
            }
            requests.push(req);
        }
    }
    let mut warnings = Vec::new();
    if requests.is_empty() {
        warnings.push("HAR 中没有找到请求".to_string());
    }
    let host = requests
        .first()
        .and_then(|r| r.url.split("://").nth(1))
        .and_then(|rest| rest.split('/').next())
        .unwrap_or("import")
        .to_string();
    Ok(ImportOutput {
        collection_name: format!("HAR 导入 · {host}"),
        description: String::new(),
        requests,
        warnings,
    })
}

/* ----------------------------------- curl ---------------------------------- */

fn tokenize_curl(input: &str) -> Vec<String> {
    let normalized = input.replace("\\\r\n", " ").replace("\\\n", " ").replace(['\r', '\n'], " ");
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let chars: Vec<char> = normalized.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if let Some(q) = quote {
            if ch == q {
                quote = None;
            } else if ch == '\\' && i + 1 < chars.len() {
                current.push(chars[i + 1]);
                i += 1;
            } else {
                current.push(ch);
            }
            i += 1;
            continue;
        }
        if ch == '\'' || ch == '"' {
            quote = Some(ch);
            i += 1;
            continue;
        }
        if ch.is_whitespace() {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
            i += 1;
            continue;
        }
        current.push(ch);
        i += 1;
    }
    if !current.is_empty() {
        tokens.push(current);
    }
    tokens
}

pub fn import_curl(content: &str, name_hint: Option<&str>) -> Result<ImportOutput, String> {
    let mut tokens = tokenize_curl(content.trim());
    if tokens.first().map(|t| t.starts_with("curl")).unwrap_or(false) {
        tokens.remove(0);
    }
    let mut method = "GET".to_string();
    let mut url = String::new();
    let mut body = String::new();
    let mut body_type = "none".to_string();
    let mut headers: Vec<KeyValue> = Vec::new();
    let mut username = String::new();
    let mut password = String::new();

    let mut i = 0;
    while i < tokens.len() {
        let token = tokens[i].clone();
        let next = |i: &mut usize| -> String {
            *i += 1;
            tokens.get(*i).cloned().unwrap_or_default()
        };
        match token.as_str() {
            "-X" | "--request" => method = next(&mut i).to_uppercase(),
            "-H" | "--header" => {
                let raw = next(&mut i);
                if let Some(index) = raw.find(':') {
                    headers.push(KeyValue::new(raw[..index].trim(), raw[index + 1..].trim()));
                }
            }
            "-d" | "--data" | "--data-raw" | "--data-binary" | "--data-urlencode" => {
                body = next(&mut i);
                let trimmed = body.trim_start();
                body_type = if trimmed.starts_with('{') || trimmed.starts_with('[') {
                    "json"
                } else {
                    "text"
                }
                .to_string();
            }
            "--json" => {
                body = next(&mut i);
                body_type = "json".to_string();
            }
            "-u" | "--user" => {
                let raw = next(&mut i);
                let mut parts = raw.splitn(2, ':');
                username = parts.next().unwrap_or("").to_string();
                password = parts.next().unwrap_or("").to_string();
            }
            "-F" | "--form" => {
                let raw = next(&mut i);
                if !body.is_empty() {
                    body.push('&');
                }
                body.push_str(&raw);
                body_type = "form".to_string();
            }
            "--url" => url = next(&mut i),
            "-I" | "--head" => method = "HEAD".to_string(),
            other => {
                if !other.starts_with('-') && url.is_empty() {
                    url = other.to_string();
                }
            }
        }
        i += 1;
    }

    if url.is_empty() {
        return Ok(ImportOutput {
            collection_name: "cURL 导入".to_string(),
            description: String::new(),
            requests: Vec::new(),
            warnings: vec!["无法从 cURL 中解析出 URL".to_string()],
        });
    }

    if body_type != "none" && !headers.iter().any(|h| h.key.eq_ignore_ascii_case("content-type")) {
        headers.push(KeyValue::new(
            "Content-Type",
            if body_type == "json" {
                "application/json"
            } else {
                "text/plain"
            },
        ));
    }

    let (url_base, params) = split_query(&url);
    let path = url
        .split("://")
        .nth(1)
        .and_then(|rest| rest.find('/').map(|i| rest[i..].to_string()))
        .unwrap_or_else(|| url_base.clone());

    let mut auth = AuthConfig::default();
    if !username.is_empty() {
        auth.kind = "basic".to_string();
        auth.username = Some(username);
        auth.password = Some(password);
    }

    Ok(ImportOutput {
        collection_name: "cURL 导入".to_string(),
        description: String::new(),
        requests: vec![ApiRequest {
            name: name_hint
                .map(|n| n.to_string())
                .unwrap_or_else(|| format!("{method} {path}")),
            method,
            url: url_base,
            params,
            headers,
            body_type,
            body,
            auth,
            ..Default::default()
        }],
        warnings: Vec::new(),
    })
}

/* ---------------------------------- entry ---------------------------------- */

pub fn import_content(
    content: &str,
    format: Option<&str>,
    collection_name: Option<&str>,
) -> Result<ImportOutput, String> {
    let resolved = format
        .map(|f| f.to_string())
        .unwrap_or_else(|| detect_format(content).to_string());
    let mut output = match resolved.as_str() {
        "openapi" => import_openapi(content)?,
        "postman" => import_postman(content)?,
        "har" => import_har(content)?,
        "curl" => import_curl(content, collection_name)?,
        _ => {
            let json: Value = serde_json::from_str(content).map_err(|e| format!("JSON 解析失败: {e}"))?;
            let requests = json
                .get("requests")
                .and_then(|r| r.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| serde_json::from_value::<ApiRequest>(item.clone()).ok())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let warnings = if requests.is_empty() {
                vec!["未找到 requests 数组，无法导入".to_string()]
            } else {
                Vec::new()
            };
            ImportOutput {
                collection_name: "作品集导入".to_string(),
                description: String::new(),
                requests,
                warnings,
            }
        }
    };
    if let Some(name) = collection_name {
        if !name.trim().is_empty() {
            output.collection_name = name.trim().to_string();
        }
    }
    Ok(output)
}
