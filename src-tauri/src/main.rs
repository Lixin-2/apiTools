#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod rest;

use apitools_core::{csv_vars, exporters, http_client, importers, load_test, model::*, store};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone)]
struct RestInfo {
    port: u16,
    token: String,
}

fn mcp_bin_name() -> &'static str {
    if cfg!(windows) {
        "apitools-mcp.exe"
    } else {
        "apitools-mcp"
    }
}

fn mcp_server_path(app: &tauri::AppHandle) -> PathBuf {
    let bin = mcp_bin_name();
    if let Ok(dir) = app.path().resource_dir() {
        for candidate in [dir.join("binaries").join(bin), dir.join(bin)] {
            if candidate.exists() {
                return candidate;
            }
        }
    }
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    let dev = exe_dir.join(bin);
    if dev.exists() {
        return dev;
    }
    exe_dir.join(bin)
}

/* ------------------------------ MCP HTTP server ----------------------------- */

struct McpHandle {
    port: u16,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
}

static MCP_RUNTIME: Mutex<Option<McpHandle>> = Mutex::new(None);

fn stop_mcp_http() {
    if let Ok(mut guard) = MCP_RUNTIME.lock() {
        if let Some(mut handle) = guard.take() {
            if let Some(tx) = handle.shutdown.take() {
                let _ = tx.send(());
            }
        }
    }
}

fn start_mcp_http(port: u16) -> Result<u16, String> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", port))
        .map_err(|e| format!("端口 {port} 无法监听（可能被占用）：{e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let actual = listener.local_addr().map_err(|e| e.to_string())?.port();
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let router = mcp_router();
    tauri::async_runtime::spawn(async move {
        match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => {
                let server = axum::serve(listener, router).with_graceful_shutdown(async {
                    let _ = rx.await;
                });
                if let Err(err) = server.await {
                    eprintln!("[apitools] MCP HTTP server error: {err}");
                }
            }
            Err(err) => eprintln!("[apitools] MCP listener error: {err}"),
        }
    });
    if let Ok(mut guard) = MCP_RUNTIME.lock() {
        *guard = Some(McpHandle {
            port: actual,
            shutdown: Some(tx),
        });
    }
    Ok(actual)
}

fn mcp_router() -> axum::Router {
    use axum::{
        http::StatusCode,
        response::IntoResponse,
        routing::{get, post},
        Json, Router,
    };

    async fn mcp_post(Json(payload): Json<Value>) -> axum::response::Response {
        let result =
            tauri::async_runtime::spawn_blocking(move || apitools_core::mcp::handle_message(&payload))
                .await
                .ok()
                .flatten();
        match result {
            Some(response) => (StatusCode::OK, Json(response)).into_response(),
            None => StatusCode::ACCEPTED.into_response(),
        }
    }

    async fn mcp_get() -> axum::response::Response {
        (
            StatusCode::METHOD_NOT_ALLOWED,
            Json(json!({
                "error": "请使用 POST /mcp 发送 JSON-RPC 请求",
                "hint": "MCP 客户端配置：{ \"url\": \"http://127.0.0.1:4732/mcp\" }"
            })),
        )
            .into_response()
    }

    async fn health() -> Json<Value> {
        Json(json!({ "ok": true, "name": "apitools-mcp", "transport": "http" }))
    }

    Router::new()
        .route("/mcp", post(mcp_post).get(mcp_get))
        .route("/health", get(health))
}

fn mcp_running_port() -> Option<u16> {
    MCP_RUNTIME
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|handle| handle.port))
}

#[tauri::command]
fn app_info(app: tauri::AppHandle, rest: State<'_, RestInfo>) -> Value {
    let mcp = mcp_server_path(&app);
    let settings = store::read_settings();
    let running_port = mcp_running_port();
    let http_port = running_port.unwrap_or(settings.mcp_port);
    json!({
        "name": "apiTools",
        "version": env!("CARGO_PKG_VERSION"),
        "port": rest.port,
        "token": rest.token,
        "dataDir": store::data_dir().to_string_lossy(),
        "dataFile": store::data_file().to_string_lossy(),
        "mcpServerPath": mcp.to_string_lossy(),
        "mcpCommand": format!("{}", mcp.to_string_lossy()),
        "mcpEnabled": settings.mcp_enabled,
        "mcpRunning": running_port.is_some(),
        "mcpPort": http_port,
        "mcpHttpUrl": format!("http://127.0.0.1:{http_port}/mcp"),
        "engine": "rust"
    })
}

fn theme_icon_path(app: &tauri::AppHandle, dark: bool) -> Option<PathBuf> {
    let name = if dark { "icon-dark.png" } else { "icon-light.png" };
    if let Ok(dir) = app.path().resource_dir() {
        for candidate in [dir.join("icons").join(name), dir.join(name)] {
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
    {
        for candidate in [exe_dir.join("icons").join(name), exe_dir.join(name)] {
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let candidate = cwd.join("src-tauri").join("icons").join(name);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

/// 根据浅色/深色外观切换 Dock 图标（浅色白底、深色黑底）
#[tauri::command]
fn set_dock_icon(app: tauri::AppHandle, dark: bool) {
    #[cfg(target_os = "macos")]
    {
        let Some(path) = theme_icon_path(&app, dark) else {
            eprintln!("[apitools] dock icon: 未找到图标资源");
            return;
        };
        let Ok(bytes) = std::fs::read(&path) else {
            return;
        };
        eprintln!(
            "[apitools] dock icon -> {} ({})",
            if dark { "dark" } else { "light" },
            path.display()
        );
        let _ = app.run_on_main_thread(move || unsafe {
            use objc2::{AnyThread, MainThreadMarker};
            use objc2_app_kit::{NSApplication, NSImage};
            use objc2_foundation::NSData;
            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            let ns_app = NSApplication::sharedApplication(mtm);
            let data = NSData::with_bytes(&bytes);
            if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
                ns_app.setApplicationIconImage(Some(&image));
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, dark);
    }
}

#[tauri::command]
fn get_settings() -> Value {
    let settings = store::read_settings();
    let running_port = mcp_running_port();
    json!({
        "mcpEnabled": settings.mcp_enabled,
        "mcpPort": running_port.unwrap_or(settings.mcp_port),
        "mcpRunning": running_port.is_some(),
        "mcpHttpUrl": format!("http://127.0.0.1:{}/mcp", running_port.unwrap_or(settings.mcp_port))
    })
}

#[tauri::command]
fn update_mcp_settings(enabled: bool, port: u16) -> Result<Value, String> {
    let mut next = store::read_settings();
    next.mcp_enabled = enabled;
    if port > 0 {
        next.mcp_port = port;
    }

    stop_mcp_http();

    if enabled {
        match start_mcp_http(next.mcp_port) {
            Ok(actual) => next.mcp_port = actual,
            Err(err) => {
                next.mcp_enabled = false;
                let _ = store::write_settings(&next);
                return Err(err);
            }
        }
    }

    store::write_settings(&next)?;
    Ok(json!({
        "mcpEnabled": next.mcp_enabled,
        "mcpPort": next.mcp_port,
        "mcpRunning": enabled,
        "mcpHttpUrl": format!("http://127.0.0.1:{}/mcp", next.mcp_port)
    }))
}

#[tauri::command]
fn read_workspace() -> Value {
    serde_json::to_value(store::snapshot()).unwrap_or_else(|_| json!({}))
}

#[tauri::command]
fn create_project(name: String, description: Option<String>) -> Result<Value, String> {
    let project = store::create_project(&name, &description.unwrap_or_default())?;
    serde_json::to_value(project).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_project(id: String, name: String, description: Option<String>) -> Result<(), String> {
    store::rename_project(&id, &name, description)
}

#[tauri::command]
fn delete_project(id: String) -> Result<bool, String> {
    store::delete_project(&id)
}

#[tauri::command]
fn set_active_project(id: String) -> Result<(), String> {
    store::set_active_project(&id)
}



#[tauri::command]
fn replace_workspace(workspace: Value) -> Result<Value, String> {
    let parsed: Workspace = serde_json::from_value(workspace).map_err(|e| format!("数据格式不正确: {e}"))?;
    let next = store::replace_workspace(parsed)?;
    serde_json::to_value(next).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_collection(name: String, description: Option<String>) -> Result<Value, String> {
    let collection = store::create_collection(&name, &description.unwrap_or_default())?;
    serde_json::to_value(collection).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_collection(id: String, patch: Value) -> Result<Option<Value>, String> {
    let name = patch.get("name").and_then(|v| v.as_str()).map(|s| s.to_string());
    let description = patch
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let updated = store::update_collection(&id, name, description)?;
    Ok(updated.and_then(|c| serde_json::to_value(c).ok()))
}

#[tauri::command]
fn delete_collection(id: String) -> Result<bool, String> {
    store::delete_collection(&id)
}

#[tauri::command]
fn create_folder(collection_id: String, name: String) -> Result<Vec<String>, String> {
    store::create_folder(&collection_id, &name)
}

#[tauri::command]
fn rename_folder(collection_id: String, old_name: String, new_name: String) -> Result<Vec<String>, String> {
    store::rename_folder(&collection_id, &old_name, &new_name)
}

#[tauri::command]
fn delete_folder(collection_id: String, name: String) -> Result<Vec<String>, String> {
    store::delete_folder(&collection_id, &name)
}

#[tauri::command]
fn save_request(input: Value) -> Result<Value, String> {
    let request = store::upsert_request(input)?;
    serde_json::to_value(request).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_request(id: String) -> Result<bool, String> {
    store::delete_request(&id)
}

#[tauri::command]
fn get_request(id: String) -> Option<Value> {
    store::get_request(&id).and_then(|r| serde_json::to_value(r).ok())
}

#[tauri::command]
async fn send_request(payload: Value) -> Result<Value, String> {
    let url = payload
        .get("url")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if url.is_empty() {
        return Err("url 不能为空".to_string());
    }
    let method = payload
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("GET")
        .to_string();
    let headers: BTreeMap<String, String> = payload
        .get("headers")
        .and_then(|h| h.as_object())
        .map(|map| {
            map.iter()
                .filter_map(|(k, v)| v.as_str().map(|text| (k.clone(), text.to_string())))
                .collect()
        })
        .unwrap_or_default();
    let body = payload
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let timeout = payload.get("timeoutMs").and_then(|v| v.as_u64());
    let parts: Vec<http_client::FormPart> = payload
        .get("formFields")
        .and_then(|value| serde_json::from_value::<Vec<FormField>>(value.clone()).ok())
        .map(|fields| {
            fields
                .into_iter()
                .filter(|field| field.enabled && !field.key.trim().is_empty())
                .map(|field| http_client::FormPart {
                    name: field.key,
                    value: if field.kind == "file" {
                        None
                    } else {
                        Some(field.value)
                    },
                    file_path: if field.kind == "file" {
                        field.file_path
                    } else {
                        None
                    },
                    file_name: field.file_name,
                    mime: field.mime,
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let response = tauri::async_runtime::spawn_blocking(move || {
        if parts.is_empty() {
            http_client::execute(&method, &url, &headers, Some(&body), timeout)
        } else {
            http_client::execute_multipart(&method, &url, &headers, &parts, timeout)
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    serde_json::to_value(response).map_err(|e| e.to_string())
}

/// 保存响应内容（二进制来自临时文件，文本直接写入），弹出保存对话框
#[tauri::command]
async fn save_response_file(
    app: tauri::AppHandle,
    source_path: Option<String>,
    content: Option<String>,
    file_name: String,
) -> Result<Option<String>, String> {
    let target_name = if file_name.trim().is_empty() {
        "response".to_string()
    } else {
        file_name
    };
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("保存响应")
            .set_file_name(&target_name)
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(target) = picked else {
        return Ok(None);
    };
    let path = target.into_path().map_err(|e| e.to_string())?;
    if let Some(source) = source_path {
        std::fs::copy(&source, &path).map_err(|e| format!("保存失败: {e}"))?;
    } else if let Some(text) = content {
        std::fs::write(&path, text).map_err(|e| format!("保存失败: {e}"))?;
    }
    Ok(Some(path.to_string_lossy().to_string()))
}

/// 直接下载到 ~/Downloads，重名自动加序号
#[tauri::command]
fn download_response_file(
    source_path: Option<String>,
    content: Option<String>,
    file_name: String,
) -> Result<String, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let dir = PathBuf::from(home).join("Downloads");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建下载目录失败: {e}"))?;
    let base = if file_name.trim().is_empty() {
        "response.bin".to_string()
    } else {
        file_name.trim().to_string()
    };
    let mut target = dir.join(&base);
    if target.exists() {
        let stem = base.rsplit_once('.').map(|(head, _)| head).unwrap_or(&base);
        let ext = base
            .rsplit_once('.')
            .map(|(_, tail)| format!(".{tail}"))
            .unwrap_or_default();
        for index in 1..1000 {
            let candidate = dir.join(format!("{stem} ({index}){ext}"));
            if !candidate.exists() {
                target = candidate;
                break;
            }
        }
    }
    if let Some(source) = source_path {
        std::fs::copy(&source, &target).map_err(|e| format!("保存失败: {e}"))?;
    } else if let Some(text) = content {
        std::fs::write(&target, text).map_err(|e| format!("保存失败: {e}"))?;
    }
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn start_load_test(app: tauri::AppHandle, config: Value) -> Result<Value, String> {
    let parsed: load_test::LoadTestConfig =
        serde_json::from_value(config).map_err(|e| format!("参数错误: {e}"))?;
    load_test::validate(&parsed)?;
    load_test::stop_current();

    // 报文池在命令里先解析，格式或体积有问题可以直接反馈给前端
    let pool = match parsed
        .body_pool_zip
        .as_ref()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
    {
        Some(path) => Arc::new(load_test::load_body_pool(&path)?),
        None => Arc::new(Vec::new()),
    };
    let pool_size = pool.len();

    // 变量 CSV：表头为变量名，按行轮询
    let csv_data = match parsed
        .variables_csv
        .as_ref()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
    {
        Some(path) => Arc::new(csv_vars::load(&path)?),
        None => Arc::new((Vec::new(), Vec::new())),
    };
    let csv_rows = csv_data.1.len();

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        load_test::run(handle, parsed, pool, csv_data).await;
    });
    Ok(json!({ "ok": true, "bodyPool": pool_size, "varRows": csv_rows }))
}

#[tauri::command]
fn inspect_body_pool(path: String) -> Result<Value, String> {
    let (count, bytes) = load_test::body_pool_info(&path)?;
    Ok(json!({ "count": count, "bytes": bytes }))
}

#[tauri::command]
fn inspect_vars_csv(path: String) -> Result<Value, String> {
    let (columns, rows) = csv_vars::load(&path)?;
    Ok(json!({ "columns": columns, "rows": rows.len() }))
}

#[tauri::command]
fn stop_load_test() {
    load_test::stop_current();
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("只允许打开 http(s) 链接".to_string());
    }
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open").arg(&url).status();
    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("cmd")
        .args(["/C", "start", "", &url])
        .status();
    #[cfg(all(unix, not(target_os = "macos")))]
    let status = std::process::Command::new("xdg-open").arg(&url).status();
    status.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn pick_file(
    app: tauri::AppHandle,
    title: Option<String>,
    extensions: Option<Vec<String>>,
) -> Result<Option<Value>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .file()
            .set_title(&title.unwrap_or_else(|| "选择文件".to_string()));
        if let Some(list) = extensions {
            let refs: Vec<&str> = list.iter().map(|item| item.as_str()).collect();
            if !refs.is_empty() {
                dialog = dialog.add_filter("支持的文件", &refs);
            }
        }
        dialog.blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(target) = picked else {
        return Ok(None);
    };
    let path = target.into_path().map_err(|e| e.to_string())?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let size = std::fs::metadata(&path).map(|meta| meta.len()).unwrap_or(0);
    Ok(Some(json!({
        "path": path.to_string_lossy(),
        "name": name,
        "size": size
    })))
}

#[tauri::command]
fn import_text(payload: Value) -> Result<Value, String> {
    let content = payload
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if content.trim().is_empty() {
        return Err("导入内容为空".to_string());
    }
    let format = payload
        .get("format")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let collection_name = payload
        .get("collectionName")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let replace = payload.get("mode").and_then(|v| v.as_str()) == Some("replace");
    let detected = format
        .clone()
        .unwrap_or_else(|| importers::detect_format(&content).to_string());

    let output = importers::import_content(&content, format.as_deref(), collection_name.as_deref())?;
    let mut result = store::apply_import(
        &output.collection_name,
        output.requests,
        &output.description,
        replace,
    )?;
    result.warnings.extend(output.warnings);
    let mut value = serde_json::to_value(result).map_err(|e| e.to_string())?;
    if let Value::Object(map) = &mut value {
        map.insert("format".into(), json!(detected));
    }
    Ok(value)
}

#[tauri::command]
async fn import_file(app: tauri::AppHandle, payload: Option<Value>) -> Result<Option<Value>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("导入接口文档")
            .add_filter("接口文档", &["json", "yaml", "yml", "har", "txt", "sh"])
            .add_filter("全部文件", &["*"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(file_path) = picked else {
        return Ok(None);
    };
    let path = file_path.into_path().map_err(|e| e.to_string())?;
    let content = std::fs::read_to_string(&path).map_err(|e| format!("读取文件失败: {e}"))?;

    let format = payload
        .as_ref()
        .and_then(|p| p.get("format"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let collection_name = payload
        .as_ref()
        .and_then(|p| p.get("collectionName"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut output = importers::import_content(&content, format.as_deref(), collection_name.as_deref())?;
    if output.collection_name.trim().is_empty() {
        output.collection_name = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "导入".to_string());
    }
    let detected = format.unwrap_or_else(|| importers::detect_format(&content).to_string());
    let mut result = store::apply_import(
        &output.collection_name,
        output.requests,
        &output.description,
        false,
    )?;
    result.warnings.extend(output.warnings);
    let mut value = serde_json::to_value(result).map_err(|e| e.to_string())?;
    if let Value::Object(map) = &mut value {
        map.insert("format".into(), json!(detected));
        map.insert("filePath".into(), json!(path.to_string_lossy()));
    }
    Ok(Some(value))
}

#[tauri::command]
async fn export_collection(app: tauri::AppHandle, payload: Value) -> Result<Option<Value>, String> {
    let collection_id = payload
        .get("collectionId")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let format = payload
        .get("format")
        .and_then(|v| v.as_str())
        .unwrap_or("postman")
        .to_string();
    let to_file = payload
        .get("toFile")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let ws = store::read_workspace();
    let Some(collection) = ws.collections.iter().find(|c| c.id == collection_id) else {
        return Err("集合不存在".to_string());
    };
    let requests: Vec<ApiRequest> = ws
        .requests
        .into_iter()
        .filter(|r| r.collection_id == collection_id)
        .collect();
    let output = exporters::export_collection(collection, &requests, &format);
    let mut value = serde_json::to_value(&output).map_err(|e| e.to_string())?;

    if to_file {
        let filename = output.filename.clone();
        let picked = tauri::async_runtime::spawn_blocking(move || {
            app.dialog()
                .file()
                .set_title("导出集合")
                .set_file_name(&filename)
                .blocking_save_file()
        })
        .await
        .map_err(|e| e.to_string())?;
        let Some(target) = picked else {
            return Ok(None);
        };
        let path = target.into_path().map_err(|e| e.to_string())?;
        std::fs::write(&path, &output.content).map_err(|e| format!("写入文件失败: {e}"))?;
        if let Value::Object(map) = &mut value {
            map.insert("filePath".into(), json!(path.to_string_lossy()));
        }
    }
    Ok(Some(value))
}

#[tauri::command]
async fn export_workspace(app: tauri::AppHandle, payload: Option<Value>) -> Result<Option<Value>, String> {
    let workspace = store::read_workspace();
    let content = serde_json::to_string_pretty(&workspace).map_err(|e| e.to_string())?;
    let filename = format!(
        "apitools-workspace-{}.json",
        chrono_like_date()
    );
    let to_file = payload
        .as_ref()
        .and_then(|p| p.get("toFile"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let mut value = json!({ "filename": filename, "content": content });
    if to_file {
        let name = filename.clone();
        let picked = tauri::async_runtime::spawn_blocking(move || {
            app.dialog()
                .file()
                .set_title("导出全部数据")
                .set_file_name(&name)
                .blocking_save_file()
        })
        .await
        .map_err(|e| e.to_string())?;
        let Some(target) = picked else {
            return Ok(None);
        };
        let path = target.into_path().map_err(|e| e.to_string())?;
        std::fs::write(&path, &content).map_err(|e| format!("写入文件失败: {e}"))?;
        if let Value::Object(map) = &mut value {
            map.insert("filePath".into(), json!(path.to_string_lossy()));
        }
    }
    Ok(Some(value))
}

fn chrono_like_date() -> String {
    let secs = now_ms() / 1000;
    let days = secs / 86_400;
    // 1970-01-01 + days
    let mut year = 1970;
    let mut remaining = days as i64;
    loop {
        let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
        let year_days = if leap { 366 } else { 365 };
        if remaining < year_days {
            break;
        }
        remaining -= year_days;
        year += 1;
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let months = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut month = 1;
    for days_in_month in months {
        if remaining < days_in_month {
            break;
        }
        remaining -= days_in_month;
        month += 1;
    }
    format!("{year:04}-{month:02}-{:02}", remaining + 1)
}

#[tauri::command]
fn save_environment(env: Value) -> Result<Value, String> {
    let saved = store::save_environment(env)?;
    serde_json::to_value(saved).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_environment(id: String) -> Result<bool, String> {
    store::delete_environment(&id)
}

#[tauri::command]
fn set_active_environment(id: Option<String>) -> Result<(), String> {
    store::set_active_environment(id)
}

#[tauri::command]
fn open_data_dir() -> String {
    let dir = store::data_dir();
    let _ = std::process::Command::new("open").arg(&dir).spawn();
    dir.to_string_lossy().to_string()
}

#[tauri::command]
fn open_external(url: String) {
    let _ = std::process::Command::new("open").arg(url).spawn();
}

fn watch_workspace(app: tauri::AppHandle) {
    use notify::{RecursiveMode, Watcher};
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    let dir = store::data_dir();
    let _ = std::fs::create_dir_all(&dir);
    let (tx, rx) = mpsc::channel();
    let Ok(mut watcher) = notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    }) else {
        return;
    };
    if watcher.watch(&dir, RecursiveMode::NonRecursive).is_err() {
        return;
    }

    std::thread::spawn(move || {
        let mut last = Instant::now() - Duration::from_secs(5);
        for res in rx {
            if res.is_err() {
                continue;
            }
            if last.elapsed() < Duration::from_millis(180) {
                continue;
            }
            last = Instant::now();
            std::thread::sleep(Duration::from_millis(60));
            let _ = app.emit("workspace:changed", ());
        }
    });

    // keep watcher alive for the app lifetime
    Box::leak(Box::new(watcher));
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            app_info,
            set_dock_icon,
            get_settings,
            update_mcp_settings,
            read_workspace,
            create_project,
            rename_project,
            delete_project,
            set_active_project,
            replace_workspace,
            create_collection,
            update_collection,
            delete_collection,
            create_folder,
            rename_folder,
            delete_folder,
            save_request,
            delete_request,
            get_request,
            send_request,
            start_load_test,
            stop_load_test,
            inspect_body_pool,
            inspect_vars_csv,
            open_url,
            pick_file,
            save_response_file,
            download_response_file,
            reveal_path,
            import_text,
            import_file,
            export_collection,
            export_workspace,
            save_environment,
            delete_environment,
            set_active_environment,
            open_data_dir,
            open_external
        ])
        .on_page_load(|_window, payload| {
            eprintln!("[apitools] page loaded: {}", payload.url());
        })
        .setup(|app| {
            let listener = std::net::TcpListener::bind(("127.0.0.1", rest::DEFAULT_PORT))
                .or_else(|_| std::net::TcpListener::bind(("127.0.0.1", 0)))?;
            listener.set_nonblocking(true)?;
            let port = listener
                .local_addr()
                .map(|addr| addr.port())
                .unwrap_or(rest::DEFAULT_PORT);
            let token = store::api_token();
            let router = rest::router(token.clone());

            tauri::async_runtime::spawn(async move {
                match tokio::net::TcpListener::from_std(listener) {
                    Ok(listener) => {
                        if let Err(err) = axum::serve(listener, router).await {
                            eprintln!("[apitools] REST server error: {err}");
                        }
                    }
                    Err(err) => eprintln!("[apitools] REST listener error: {err}"),
                }
            });

            app.manage(RestInfo { port, token });
            let handle = app.handle().clone();
            watch_workspace(handle);

            // 按设置自动启动 MCP HTTP 服务
            let settings = store::read_settings();
            if settings.mcp_enabled {
                match start_mcp_http(settings.mcp_port) {
                    Ok(port) => eprintln!("[apitools] MCP HTTP listening on 127.0.0.1:{port}/mcp"),
                    Err(err) => {
                        // 端口冲突时回退到系统分配端口，但保留用户配置，下次启动继续尝试
                        eprintln!("[apitools] MCP 自动启动失败: {err}");
                        if let Ok(port) = start_mcp_http(0) {
                            eprintln!("[apitools] 已回退到随机端口 127.0.0.1:{port}/mcp");
                        }
                    }
                }
            }

            // 便于自动化冒烟测试：APITOOLS_SELFTEST=1 时自动点击一次「发送」
            if std::env::var("APITOOLS_SELFTEST").as_deref() == Ok("1") {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(2500));
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.eval(
                            "document.querySelector('.send-btn') && document.querySelector('.send-btn').click();",
                        );
                    }
                });
            }

            // 调试/截图辅助：APITOOLS_EVAL="js" 时延迟执行一段前端脚本
            if let Ok(script) = std::env::var("APITOOLS_EVAL") {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(2200));
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.eval(&script);
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running apiTools");
}
