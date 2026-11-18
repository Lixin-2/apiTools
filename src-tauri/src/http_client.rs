use crate::model::{now_ms, SendResponse};
use std::collections::BTreeMap;
use std::io::Read;
use std::time::{Duration, Instant};

const MAX_BODY: u64 = 20 * 1024 * 1024;

fn build_response(resp: ureq::Response, started: Instant) -> SendResponse {
    let status = resp.status();
    let status_text = resp.status_text().to_string();
    let mut headers: BTreeMap<String, String> = BTreeMap::new();
    for name in resp.headers_names() {
        if let Some(value) = resp.header(&name) {
            headers.insert(name.to_lowercase(), value.to_string());
        }
    }
    let content_type = headers
        .get("content-type")
        .cloned()
        .unwrap_or_default()
        .to_lowercase();

    let mut bytes: Vec<u8> = Vec::new();
    if let Err(err) = resp.into_reader().take(MAX_BODY).read_to_end(&mut bytes) {
        return SendResponse::failure(format!("读取响应失败: {err}"), started.elapsed().as_millis() as u64);
    }
    let size = bytes.len();
    let text = String::from_utf8_lossy(&bytes).to_string();
    let trimmed = text.trim_start();
    let is_json = content_type.contains("json")
        || trimmed.starts_with('{')
        || trimmed.starts_with('[');
    let is_binary = content_type.starts_with("image/")
        || content_type.starts_with("video/")
        || content_type.starts_with("audio/")
        || content_type.starts_with("font/")
        || content_type.contains("octet-stream")
        || content_type.contains("application/pdf")
        || content_type.contains("application/zip");

    let (body, body_kind) = if is_binary && !is_json {
        (format!("[binary {size} bytes]"), "binary")
    } else if is_json {
        (text, "json")
    } else {
        (text, "text")
    };

    SendResponse {
        ok: (200..400).contains(&status),
        status,
        status_text,
        headers,
        body,
        body_kind: body_kind.to_string(),
        size,
        time_ms: started.elapsed().as_millis() as u64,
        error: None,
    }
}

pub struct FormPart {
    pub name: String,
    pub value: Option<String>,
    pub file_path: Option<String>,
    pub file_name: Option<String>,
    pub mime: Option<String>,
}

fn guess_mime(file_name: &str) -> String {
    let lower = file_name.to_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".pdf") {
        "application/pdf"
    } else if lower.ends_with(".json") {
        "application/json"
    } else if lower.ends_with(".txt") || lower.ends_with(".md") {
        "text/plain"
    } else if lower.ends_with(".zip") {
        "application/zip"
    } else {
        "application/octet-stream"
    }
    .to_string()
}

fn build_multipart(parts: &[FormPart]) -> Result<(String, Vec<u8>), String> {
    let boundary = format!("----apiToolsBoundary{}", now_ms());
    let mut payload: Vec<u8> = Vec::new();
    for part in parts {
        payload.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        if let Some(path) = part.file_path.as_deref().filter(|p| !p.is_empty()) {
            let fallback = path.rsplit('/').next().unwrap_or("file").to_string();
            let file_name = part
                .file_name
                .clone()
                .filter(|name| !name.is_empty())
                .unwrap_or(fallback);
            let mime = part
                .mime
                .clone()
                .filter(|m| !m.is_empty())
                .unwrap_or_else(|| guess_mime(&file_name));
            payload.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"{}\"; filename=\"{}\"\r\nContent-Type: {}\r\n\r\n",
                    part.name, file_name, mime
                )
                .as_bytes(),
            );
            let bytes = std::fs::read(path).map_err(|e| format!("读取文件失败（{path}）：{e}"))?;
            payload.extend_from_slice(&bytes);
        } else {
            payload.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"{}\"\r\n\r\n{}",
                    part.name,
                    part.value.clone().unwrap_or_default()
                )
                .as_bytes(),
            );
        }
        payload.extend_from_slice(b"\r\n");
    }
    payload.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    Ok((boundary, payload))
}

fn send_bytes(
    method: &str,
    url: &str,
    mut headers: BTreeMap<String, String>,
    payload: Vec<u8>,
    timeout_ms: Option<u64>,
) -> SendResponse {
    let started = Instant::now();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return SendResponse::failure(
            "URL 缺少协议：请补全 http(s)://；若使用了 {{baseUrl}}，请先在「环境」中配置该变量",
            0,
        );
    }
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(30_000).clamp(1_000, 300_000));
    let agent = ureq::AgentBuilder::new().timeout(timeout).build();
    let mut request = agent.request(method, url);
    let keys: Vec<String> = headers.keys().cloned().collect();
    for key in keys {
        if let Some(value) = headers.remove(&key) {
            request = request.set(&key, &value);
        }
    }
    match request.send_bytes(&payload) {
        Ok(resp) => build_response(resp, started),
        Err(ureq::Error::Status(_code, resp)) => build_response(resp, started),
        Err(err) => SendResponse::failure(err.to_string(), started.elapsed().as_millis() as u64),
    }
}

/// 发送 multipart/form-data 请求（表单字段可包含文件）
pub fn execute_multipart(
    method: &str,
    url: &str,
    headers: &BTreeMap<String, String>,
    parts: &[FormPart],
    timeout_ms: Option<u64>,
) -> SendResponse {
    let (boundary, payload) = match build_multipart(parts) {
        Ok(result) => result,
        Err(err) => return SendResponse::failure(err, 0),
    };
    let mut next = BTreeMap::new();
    for (key, value) in headers {
        if key.eq_ignore_ascii_case("content-type") || key.eq_ignore_ascii_case("content-length") {
            continue;
        }
        next.insert(key.clone(), value.clone());
    }
    next.insert(
        "content-type".to_string(),
        format!("multipart/form-data; boundary={boundary}"),
    );
    send_bytes(method, url, next, payload, timeout_ms)
}

pub fn execute(
    method: &str,
    url: &str,
    headers: &BTreeMap<String, String>,
    body: Option<&str>,
    timeout_ms: Option<u64>,
) -> SendResponse {
    let started = Instant::now();
    let method_upper = method.to_uppercase();

    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return SendResponse::failure(
            "URL 缺少协议：请补全 http(s)://；若使用了 {{baseUrl}}，请先在「环境」中配置该变量",
            0,
        );
    }

    let timeout = Duration::from_millis(timeout_ms.unwrap_or(30_000).clamp(1_000, 300_000));
    let agent = ureq::AgentBuilder::new().timeout(timeout).build();
    let mut request = agent.request(&method_upper, url);
    for (key, value) in headers {
        request = request.set(key, value);
    }

    let result = match (method_upper.as_str(), body) {
        ("GET" | "HEAD" | "OPTIONS", _) | (_, None) => request.call(),
        (_, Some(payload)) if payload.is_empty() => request.call(),
        (_, Some(payload)) => request.send_string(payload),
    };

    match result {
        Ok(resp) => build_response(resp, started),
        Err(ureq::Error::Status(_code, resp)) => build_response(resp, started),
        Err(err) => SendResponse::failure(
            {
                let text = err.to_string();
                if text.to_lowercase().contains("timed out") || text.to_lowercase().contains("timeout") {
                    "请求超时".to_string()
                } else {
                    text
                }
            },
            started.elapsed().as_millis() as u64,
        ),
    }
}
