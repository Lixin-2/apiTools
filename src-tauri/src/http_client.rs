use crate::model::{now_ms, SendResponse};
use std::collections::BTreeMap;
use std::io::Read;
use std::time::{Duration, Instant};

const MAX_BODY: u64 = 50 * 1024 * 1024;
const PREVIEW_LIMIT: usize = 2 * 1024 * 1024;

/// 解码 %XX 与 +（Content-Disposition 与路径里常见）
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[index + 1..index + 3]) {
                if let Ok(value) = u8::from_str_radix(hex, 16) {
                    out.push(value);
                    index += 3;
                    continue;
                }
            }
        }
        if bytes[index] == b'+' {
            out.push(b' ');
            index += 1;
            continue;
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| {
            if ch.is_control() || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                ch
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        "response.bin".to_string()
    } else {
        trimmed
    }
}

fn filename_from_headers(headers: &BTreeMap<String, String>, url: &str, mime: &str) -> String {
    if let Some(disposition) = headers.get("content-disposition") {
        let lower = disposition.to_lowercase();
        if let Some(index) = lower.find("filename*=") {
            let rest = &disposition[index + 10..];
            let raw = rest.split(';').next().unwrap_or(rest).trim().trim_matches('"');
            let decoded = raw.rsplit("''").next().unwrap_or(raw);
            let decoded = percent_decode(decoded);
            if !decoded.trim().is_empty() {
                return sanitize_filename(&decoded);
            }
        }
        if let Some(index) = lower.find("filename=") {
            let rest = &disposition[index + 9..];
            let raw = rest.split(';').next().unwrap_or(rest).trim().trim_matches('"');
            let decoded = percent_decode(raw);
            if !decoded.trim().is_empty() {
                return sanitize_filename(&decoded);
            }
        }
    }
    let no_query = url.split('?').next().unwrap_or(url);
    let mut segments = no_query.trim_end_matches('/').rsplit('/');
    let last = segments.next().unwrap_or("");
    if !last.is_empty() && last.contains('.') {
        return sanitize_filename(&percent_decode(last));
    }
    // 形如 /image/png 的地址：把上一段当名字、最后一段当扩展名
    let known_ext = [
        "png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "zip", "csv", "txt", "json", "xml",
        "bin", "xlsx", "docx", "mp4", "mp3",
    ];
    if known_ext.contains(&last.to_lowercase().as_str()) {
        if let Some(previous) = segments.next() {
            if !previous.is_empty() {
                return format!(
                    "{}.{}",
                    sanitize_filename(&percent_decode(previous)),
                    last.to_lowercase()
                );
            }
        }
    }
    let subtype = mime.split(';').next().unwrap_or(mime).rsplit('/').next().unwrap_or("bin");
    let ext = match subtype {
        "png" | "jpeg" | "jpg" | "gif" | "webp" | "pdf" | "zip" | "csv" => subtype,
        "svg+xml" => "svg",
        "plain" => "txt",
        "octet-stream" | "msword" | "excel" | "spreadsheet" | "presentation" => "bin",
        other if !other.is_empty() && !other.contains('+') => other,
        _ => "bin",
    };
    format!("response-{}.{}", now_ms(), ext)
}

fn is_binary_mime(content_type: &str) -> bool {
    let ct = content_type.split(';').next().unwrap_or(content_type).trim();
    if ct.is_empty() {
        return false;
    }
    if ct.starts_with("image/") && !ct.contains("svg") {
        return true;
    }
    if ct.starts_with("audio/") || ct.starts_with("video/") || ct.starts_with("font/") {
        return true;
    }
    const HINTS: [&str; 16] = [
        "octet-stream",
        "officedocument",
        "ms-excel",
        "ms-word",
        "ms-powerpoint",
        "spreadsheetml",
        "wordprocessingml",
        "presentationml",
        "pdf",
        "zip",
        "gzip",
        "x-rar",
        "x-7z",
        "x-tar",
        "protobuf",
        "wasm",
    ];
    HINTS.iter().any(|hint| ct.contains(hint))
}

fn is_text_mime(content_type: &str) -> bool {
    let ct = content_type.split(';').next().unwrap_or(content_type).trim();
    ct.starts_with("text/")
        || ct.contains("json")
        || ct == "application/xml"
        || ct.ends_with("+xml")
        || ct.contains("javascript")
        || ct.contains("ecmascript")
        || ct.contains("x-www-form-urlencoded")
        || ct.contains("graphql")
        || ct.contains("csv")
        || ct.contains("yaml")
}

fn has_binary_magic(bytes: &[u8]) -> bool {
    const SIGS: [&[u8]; 11] = [
        b"PK\x03\x04",
        b"PK\x05\x06",
        b"%PDF",
        b"\x89PNG",
        b"GIF8",
        b"\xFF\xD8\xFF",
        b"RIFF",
        b"OggS",
        b"\x1f\x8b",
        b"\xD0\xCF\x11\xE0",
        b"BM",
    ];
    SIGS.iter().any(|sig| bytes.starts_with(sig))
}

fn looks_like_text(content_type: &str, bytes: &[u8]) -> bool {
    // 1) 明确的二进制类型优先（Excel/Word/PPT 的 MIME 里带 xml，不能先判文本）
    if is_binary_mime(content_type) {
        return false;
    }
    // 2) 明确的文本类型
    if is_text_mime(content_type) {
        return true;
    }
    // 3) 没有可信 content-type 时看文件头
    if has_binary_magic(bytes) {
        return false;
    }
    // 4) 最后用严格 UTF-8 校验
    if bytes.is_empty() {
        return true;
    }
    std::str::from_utf8(bytes).is_ok()
}

fn store_download(bytes: &[u8], file_name: &str) -> Option<String> {
    let dir = std::env::temp_dir().join("apitools-downloads");
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join(format!("{}-{}", now_ms(), sanitize_filename(file_name)));
    std::fs::write(&path, bytes).ok()?;
    Some(path.to_string_lossy().to_string())
}

fn image_preview(mime: &str, bytes: &[u8]) -> Option<String> {
    use base64::Engine;
    let ct = mime.split(';').next().unwrap_or(mime).trim();
    if !ct.starts_with("image/") || bytes.len() > PREVIEW_LIMIT {
        return None;
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{ct};base64,{encoded}"))
}

fn build_response(resp: ureq::Response, started: Instant, url: &str) -> SendResponse {
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
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_string();

    let mut bytes: Vec<u8> = Vec::new();
    if let Err(err) = resp
        .into_reader()
        .take(MAX_BODY + 1)
        .read_to_end(&mut bytes)
    {
        return SendResponse::failure(
            format!("读取响应失败: {err}"),
            started.elapsed().as_millis() as u64,
        );
    }
    let truncated = bytes.len() as u64 > MAX_BODY;
    if truncated {
        bytes.truncate(MAX_BODY as usize);
    }
    let size = bytes.len();
    let time_ms = started.elapsed().as_millis() as u64;
    let ok = (200..400).contains(&status);
    let warning = if truncated {
        Some(format!(
            "响应超过 {} MB，已截断",
            MAX_BODY / 1024 / 1024
        ))
    } else {
        None
    };

    // 文本 / JSON 直接返回内容；二进制落到临时文件并给出下载信息
    if looks_like_text(&content_type, &bytes) {
        let text = String::from_utf8_lossy(&bytes).to_string();
        let trimmed = text.trim_start();
        let is_json = content_type.contains("json")
            || trimmed.starts_with('{')
            || trimmed.starts_with('[');
        return SendResponse {
            ok,
            status,
            status_text,
            headers,
            body: text,
            body_kind: if is_json { "json".to_string() } else { "text".to_string() },
            size,
            time_ms,
            error: warning,
            file_path: None,
            file_name: None,
            mime: Some(mime).filter(|value| !value.is_empty()),
            preview: None,
        };
    }

    let file_name = filename_from_headers(&headers, url, &mime);
    let file_path = store_download(&bytes, &file_name);
    let preview = image_preview(&mime, &bytes);
    SendResponse {
        ok,
        status,
        status_text,
        headers,
        body: String::new(),
        body_kind: "binary".to_string(),
        size,
        time_ms,
        error: warning,
        file_path,
        file_name: Some(file_name),
        mime: Some(mime).filter(|value| !value.is_empty()),
        preview,
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
        Ok(resp) => build_response(resp, started, url),
        Err(ureq::Error::Status(_code, resp)) => build_response(resp, started, url),
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
        Ok(resp) => build_response(resp, started, url),
        Err(ureq::Error::Status(_code, resp)) => build_response(resp, started, url),
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
