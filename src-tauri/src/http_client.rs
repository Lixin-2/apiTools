use crate::model::SendResponse;
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
