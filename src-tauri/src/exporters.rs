use crate::model::*;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

fn split_url(url: &str) -> (String, String, String) {
    if let Some((protocol, rest)) = url.split_once("://") {
        let (host, path) = match rest.find('/') {
            Some(index) => (&rest[..index], &rest[index..]),
            None => (rest, "/"),
        };
        let host = host.split('?').next().unwrap_or(host);
        let path = path.split('?').next().unwrap_or(path).to_string();
        (
            protocol.to_string(),
            host.to_string(),
            if path.is_empty() { "/".to_string() } else { path },
        )
    } else {
        (String::new(), String::new(), url.split('?').next().unwrap_or("/").to_string())
    }
}

fn postman_item(req: &ApiRequest) -> Value {
    let (protocol, host, path) = split_url(&req.url);
    let query: Vec<Value> = req
        .params
        .iter()
        .filter(|p| !p.key.is_empty())
        .map(|p| {
            let mut item = Map::new();
            item.insert("key".into(), json!(p.key));
            item.insert("value".into(), json!(p.value));
            if !p.enabled {
                item.insert("disabled".into(), json!(true));
            }
            Value::Object(item)
        })
        .collect();

    let mut url_obj = Map::new();
    url_obj.insert("raw".into(), json!(req.url));
    if !protocol.is_empty() {
        url_obj.insert("protocol".into(), json!(protocol));
    }
    if !host.is_empty() {
        url_obj.insert("host".into(), json!(host.split('.').collect::<Vec<_>>()));
        url_obj.insert(
            "path".into(),
            json!(path
                .split('/')
                .filter(|segment| !segment.is_empty())
                .collect::<Vec<_>>()),
        );
    }
    if !query.is_empty() {
        url_obj.insert("query".into(), Value::Array(query));
    }

    let header: Vec<Value> = req
        .headers
        .iter()
        .filter(|h| !h.key.is_empty())
        .map(|h| {
            let mut item = Map::new();
            item.insert("key".into(), json!(h.key));
            item.insert("value".into(), json!(h.value));
            if !h.enabled {
                item.insert("disabled".into(), json!(true));
            }
            Value::Object(item)
        })
        .collect();

    let mut request = Map::new();
    request.insert("method".into(), json!(req.method));
    request.insert("header".into(), Value::Array(header));
    request.insert("url".into(), Value::Object(url_obj));
    if req.body_type != "none" && !req.body.is_empty() {
        let body = match req.body_type.as_str() {
            "json" | "text" => json!({
                "mode": "raw",
                "raw": req.body,
                "options": { "raw": { "language": if req.body_type == "json" { "json" } else { "text" } } }
            }),
            "form" => json!({
                "mode": "formdata",
                "formdata": req.body.split('&').filter(|p| !p.is_empty()).map(|pair| {
                    let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
                    json!({ "key": key, "value": value })
                }).collect::<Vec<_>>()
            }),
            _ => json!({
                "mode": "urlencoded",
                "urlencoded": req.body.split('&').filter(|p| !p.is_empty()).map(|pair| {
                    let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
                    json!({ "key": key, "value": value })
                }).collect::<Vec<_>>()
            }),
        };
        request.insert("body".into(), body);
    }
    if !req.description.is_empty() {
        request.insert("description".into(), json!(req.description));
    }

    json!({ "name": req.name, "request": Value::Object(request), "response": [] })
}

pub fn to_postman(collection: &Collection, requests: &[ApiRequest]) -> String {
    let mut root: Vec<Value> = Vec::new();
    let mut folders: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    for request in requests {
        if request.folder.is_empty() {
            root.push(postman_item(request));
        } else {
            folders
                .entry(request.folder.clone())
                .or_default()
                .push(postman_item(request));
        }
    }
    let mut items = root;
    for (folder, list) in folders {
        items.push(json!({ "name": folder, "item": list }));
    }
    let payload = json!({
        "info": {
            "name": collection.name,
            "description": collection.description,
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
        },
        "item": items
    });
    serde_json::to_string_pretty(&payload).unwrap_or_default()
}

pub fn to_openapi(collection: &Collection, requests: &[ApiRequest]) -> String {
    let mut paths: BTreeMap<String, Map<String, Value>> = BTreeMap::new();
    let mut server_url = String::new();
    let mut tags: Vec<String> = Vec::new();

    for req in requests {
        let (protocol, host, pathname) = split_url(&req.url);
        if server_url.is_empty() && !host.is_empty() {
            server_url = format!("{protocol}://{host}");
        }
        let mut path_key = if pathname.starts_with('/') {
            pathname
        } else {
            format!("/{pathname}")
        };
        if path_key.contains("{{") {
            let mut cleaned = String::new();
            let mut in_var = false;
            for ch in path_key.chars() {
                match ch {
                    '{' => in_var = true,
                    '}' => {
                        if in_var {
                            cleaned.push_str("{var}");
                        }
                        in_var = false;
                    }
                    _ => {
                        if !in_var {
                            cleaned.push(ch);
                        }
                    }
                }
            }
            path_key = cleaned;
        }

        let mut parameters: Vec<Value> = Vec::new();
        for p in req.params.iter().filter(|p| !p.key.is_empty()) {
            parameters.push(json!({
                "name": p.key,
                "in": "query",
                "required": false,
                "schema": { "type": "string" },
                "example": p.value
            }));
        }
        for h in req.headers.iter().filter(|h| !h.key.is_empty()) {
            if ["content-type", "host", "content-length"]
                .iter()
                .any(|skip| h.key.eq_ignore_ascii_case(skip))
            {
                continue;
            }
            parameters.push(json!({
                "name": h.key,
                "in": "header",
                "required": false,
                "schema": { "type": "string" },
                "example": h.value
            }));
        }

        let mut operation = Map::new();
        operation.insert("summary".into(), json!(req.name));
        if !req.description.is_empty() {
            operation.insert("description".into(), json!(req.description));
        }
        operation.insert(
            "operationId".into(),
            json!(format!(
                "{}_{}",
                req.method.to_lowercase(),
                path_key.chars().map(|c| if c.is_alphanumeric() { c } else { '_' }).collect::<String>()
            )),
        );
        if !req.folder.is_empty() {
            operation.insert("tags".into(), json!([req.folder]));
            if !tags.contains(&req.folder) {
                tags.push(req.folder.clone());
            }
        }
        if !parameters.is_empty() {
            operation.insert("parameters".into(), Value::Array(parameters));
        }
        operation.insert("responses".into(), json!({ "200": { "description": "OK" } }));

        if req.body_type != "none" && !req.body.is_empty() {
            let (mime, schema, example) = match req.body_type.as_str() {
                "json" => (
                    "application/json",
                    json!({ "type": "object" }),
                    serde_json::from_str::<Value>(&req.body).unwrap_or_else(|_| json!(req.body)),
                ),
                "form" => (
                    "multipart/form-data",
                    json!({ "type": "object" }),
                    json!(req.body),
                ),
                "urlencoded" => (
                    "application/x-www-form-urlencoded",
                    json!({ "type": "object" }),
                    json!(req.body),
                ),
                _ => ("text/plain", json!({ "type": "string" }), json!(req.body)),
            };
            let mut content = Map::new();
            content.insert(
                mime.to_string(),
                json!({ "schema": schema, "example": example }),
            );
            operation.insert(
                "requestBody".into(),
                json!({ "content": Value::Object(content) }),
            );
        }

        paths
            .entry(path_key)
            .or_default()
            .insert(req.method.to_lowercase(), Value::Object(operation));
    }

    let paths_value: Map<String, Value> = paths
        .into_iter()
        .map(|(key, ops)| (key, Value::Object(ops)))
        .collect();

    let mut spec = Map::new();
    spec.insert("openapi".into(), json!("3.0.3"));
    spec.insert(
        "info".into(),
        json!({
            "title": collection.name,
            "description": collection.description,
            "version": "1.0.0"
        }),
    );
    if !server_url.is_empty() {
        spec.insert("servers".into(), json!([{ "url": server_url }]));
    }
    if !tags.is_empty() {
        spec.insert(
            "tags".into(),
            json!(tags.iter().map(|name| json!({ "name": name })).collect::<Vec<_>>()),
        );
    }
    spec.insert("paths".into(), Value::Object(paths_value));
    serde_json::to_string_pretty(&Value::Object(spec)).unwrap_or_default()
}

pub fn to_apitools(collection: &Collection, requests: &[ApiRequest]) -> String {
    let payload = json!({
        "version": 1,
        "collections": [collection],
        "requests": requests
    });
    serde_json::to_string_pretty(&payload).unwrap_or_default()
}

fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '.' | '_' | '-' | '·') {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "collection".to_string()
    } else {
        trimmed
    }
}

pub fn export_collection(
    collection: &Collection,
    requests: &[ApiRequest],
    format: &str,
) -> ExportOutput {
    let safe = safe_name(&collection.name);
    match format {
        "openapi" => ExportOutput {
            format: "openapi".to_string(),
            filename: format!("{safe}.openapi.json"),
            content: to_openapi(collection, requests),
        },
        "apitools" => ExportOutput {
            format: "apitools".to_string(),
            filename: format!("{safe}.apitools.json"),
            content: to_apitools(collection, requests),
        },
        _ => ExportOutput {
            format: "postman".to_string(),
            filename: format!("{safe}.postman_collection.json"),
            content: to_postman(collection, requests),
        },
    }
}
