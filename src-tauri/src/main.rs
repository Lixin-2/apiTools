#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod rest;

use apitools_core::{exporters, http_client, importers, model::*, store};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Clone)]
struct RestInfo {
    port: u16,
    token: String,
}

fn mcp_server_path(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(dir) = app.path().resource_dir() {
        for candidate in [
            dir.join("binaries").join("apitools-mcp"),
            dir.join("apitools-mcp"),
        ] {
            if candidate.exists() {
                return candidate;
            }
        }
    }
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    let dev = exe_dir.join("apitools-mcp");
    if dev.exists() {
        return dev;
    }
    exe_dir.join("apitools-mcp")
}

#[tauri::command]
fn app_info(app: tauri::AppHandle, rest: State<'_, RestInfo>) -> Value {
    let mcp = mcp_server_path(&app);
    json!({
        "name": "apiTools",
        "version": env!("CARGO_PKG_VERSION"),
        "port": rest.port,
        "token": rest.token,
        "dataDir": store::data_dir().to_string_lossy(),
        "dataFile": store::data_file().to_string_lossy(),
        "mcpServerPath": mcp.to_string_lossy(),
        "mcpCommand": format!("{}", mcp.to_string_lossy()),
        "engine": "rust"
    })
}

#[tauri::command]
fn read_workspace() -> Value {
    serde_json::to_value(store::read_workspace()).unwrap_or_else(|_| json!({}))
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

    let response = tauri::async_runtime::spawn_blocking(move || {
        http_client::execute(&method, &url, &headers, Some(&body), timeout)
    })
    .await
    .map_err(|e| e.to_string())?;
    serde_json::to_value(response).map_err(|e| e.to_string())
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
        .invoke_handler(tauri::generate_handler![
            app_info,
            read_workspace,
            replace_workspace,
            create_collection,
            update_collection,
            delete_collection,
            save_request,
            delete_request,
            get_request,
            send_request,
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running apiTools");
}
