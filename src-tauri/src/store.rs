use crate::model::*;
use serde_json::{json, Value};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime};

pub fn data_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("APITOOLS_DATA_DIR") {
        if !custom.trim().is_empty() {
            return PathBuf::from(custom);
        }
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    if cfg!(target_os = "windows") {
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| format!("{home}/AppData/Roaming"));
        PathBuf::from(appdata).join("apiTools")
    } else if cfg!(target_os = "macos") {
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("apiTools")
    } else {
        let base = std::env::var("XDG_CONFIG_HOME").unwrap_or_else(|_| format!("{home}/.config"));
        PathBuf::from(base).join("apiTools")
    }
}

pub fn data_file() -> PathBuf {
    data_dir().join("workspace.json")
}

/* ---------------------------------- locking -------------------------------- */

struct LockGuard {
    path: PathBuf,
}

impl Drop for LockGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn acquire_lock() -> Result<LockGuard, String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    let path = dir.join("workspace.json.lock");
    let start = Instant::now();
    loop {
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                let _ = write!(file, "{}", std::process::id());
                return Ok(LockGuard { path });
            }
            Err(err) => {
                if err.kind() != std::io::ErrorKind::AlreadyExists {
                    return Err(format!("获取文件锁失败: {err}"));
                }
                if let Ok(meta) = fs::metadata(&path) {
                    if let Ok(modified) = meta.modified() {
                        if SystemTime::now()
                            .duration_since(modified)
                            .map(|d| d.as_secs() > 10)
                            .unwrap_or(false)
                        {
                            let _ = fs::remove_file(&path);
                            continue;
                        }
                    }
                }
                if start.elapsed() > Duration::from_secs(3) {
                    let _ = fs::remove_file(&path);
                    continue;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
        }
    }
}

/* --------------------------------- workspace -------------------------------- */

pub fn read_workspace() -> Workspace {
    let file = data_file();
    let Ok(raw) = fs::read_to_string(&file) else {
        return Workspace::default();
    };
    if raw.trim().is_empty() {
        return Workspace::default();
    }
    serde_json::from_str(&raw).unwrap_or_default()
}

pub fn write_workspace(ws: &Workspace) -> Result<Workspace, String> {
    let mut next = ws.clone();
    next.updated_at = now_ms();
    fs::create_dir_all(data_dir()).map_err(|e| format!("创建数据目录失败: {e}"))?;
    let target = data_file();
    let tmp = data_dir().join(format!(
        "workspace.json.tmp-{}-{}",
        std::process::id(),
        now_ms()
    ));
    let text = serde_json::to_string_pretty(&next).map_err(|e| format!("序列化失败: {e}"))?;
    fs::write(&tmp, text).map_err(|e| format!("写入失败: {e}"))?;
    fs::rename(&tmp, &target).map_err(|e| format!("重命名失败: {e}"))?;
    Ok(next)
}

pub fn mutate<T>(f: impl FnOnce(&mut Workspace) -> T) -> Result<T, String> {
    let _guard = acquire_lock()?;
    let mut ws = read_workspace();
    let out = f(&mut ws);
    write_workspace(&ws)?;
    Ok(out)
}

pub fn ensure_collection(ws: &mut Workspace, name: &str) -> Collection {
    if let Some(found) = ws.collections.iter().find(|c| c.name == name) {
        return found.clone();
    }
    let collection = Collection::new(name, "");
    ws.collections.push(collection.clone());
    collection
}

/* ------------------------------- collections ------------------------------- */

pub fn create_collection(name: &str, description: &str) -> Result<Collection, String> {
    mutate(|ws| {
        let collection = Collection::new(name, description);
        ws.collections.push(collection.clone());
        collection
    })
}

pub fn update_collection(id: &str, name: Option<String>, description: Option<String>) -> Result<Option<Collection>, String> {
    mutate(|ws| {
        let Some(col) = ws.collections.iter_mut().find(|c| c.id == id) else {
            return None;
        };
        if let Some(name) = name {
            col.name = name;
        }
        if let Some(description) = description {
            col.description = description;
        }
        col.updated_at = now_ms();
        Some(col.clone())
    })
}

pub fn delete_collection(id: &str) -> Result<bool, String> {
    mutate(|ws| {
        let before = ws.collections.len();
        ws.collections.retain(|c| c.id != id);
        ws.requests.retain(|r| r.collection_id != id);
        ws.collections.len() < before
    })
}

/* --------------------------------- requests -------------------------------- */

fn merge_json(base: Value, patch: Value) -> Value {
    match (base, patch) {
        (Value::Object(mut b), Value::Object(p)) => {
            for (key, value) in p {
                if value.is_null() {
                    b.remove(&key);
                } else {
                    let merged = match b.remove(&key) {
                        Some(existing) => merge_json(existing, value),
                        None => value,
                    };
                    b.insert(key, merged);
                }
            }
            Value::Object(b)
        }
        (_, patch) => patch,
    }
}

pub fn upsert_request(input: Value) -> Result<ApiRequest, String> {
    mutate(|ws| {
        let collection_name = input
            .get("collectionName")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let collection_id = input
            .get("collectionId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let collection = match collection_name {
            Some(name) => ensure_collection(ws, &name),
            None => match collection_id {
                Some(id) => ws
                    .collections
                    .iter()
                    .find(|c| c.id == id)
                    .cloned()
                    .unwrap_or_else(|| ensure_collection(ws, "默认集合")),
                None => ensure_collection(ws, "默认集合"),
            },
        };

        let existing_index = input
            .get("id")
            .and_then(|v| v.as_str())
            .and_then(|id| ws.requests.iter().position(|r| r.id == id));

        let base = match existing_index {
            Some(index) => ws.requests[index].clone(),
            None => ApiRequest::default(),
        };
        let base_value = serde_json::to_value(&base).unwrap_or_else(|_| json!({}));
        let mut merged = merge_json(base_value, input);
        if let Value::Object(map) = &mut merged {
            map.insert("collectionId".into(), json!(collection.id));
            map.insert("updatedAt".into(), json!(now_ms()));
            if existing_index.is_none() {
                map.insert("createdAt".into(), json!(now_ms()));
            }
        }
        let mut request: ApiRequest = serde_json::from_value(merged).unwrap_or(base);
        if request.name.trim().is_empty() {
            request.name = if request.url.trim().is_empty() {
                "未命名请求".to_string()
            } else {
                request.url.clone()
            };
        }

        if let Some(index) = existing_index {
            ws.requests[index] = request.clone();
        } else {
            ws.requests.push(request.clone());
        }
        if let Some(col) = ws.collections.iter_mut().find(|c| c.id == collection.id) {
            col.updated_at = now_ms();
        }
        request
    })
}

pub fn delete_request(id: &str) -> Result<bool, String> {
    mutate(|ws| {
        let before = ws.requests.len();
        ws.requests.retain(|r| r.id != id);
        ws.requests.len() < before
    })
}

pub fn get_request(id: &str) -> Option<ApiRequest> {
    read_workspace().requests.into_iter().find(|r| r.id == id)
}

/* ---------------------------------- import --------------------------------- */

pub fn apply_import(
    collection_name: &str,
    requests: Vec<ApiRequest>,
    description: &str,
    replace: bool,
) -> Result<ImportResult, String> {
    mutate(|ws| {
        let collection = ensure_collection(ws, collection_name);
        if description.is_empty() {
            // keep existing description when merging
        } else if let Some(col) = ws.collections.iter_mut().find(|c| c.id == collection.id) {
            if col.description.is_empty() {
                col.description = description.to_string();
            }
        }
        if replace {
            ws.requests.retain(|r| r.collection_id != collection.id);
        }
        let mut seen: Vec<String> = ws
            .requests
            .iter()
            .filter(|r| r.collection_id == collection.id)
            .map(|r| format!("{} {} {}", r.method, r.url, r.name))
            .collect();
        let mut imported = 0usize;
        let mut skipped = 0usize;
        for request in requests {
            let key = format!("{} {} {}", request.method, request.url, request.name);
            if seen.contains(&key) {
                skipped += 1;
                continue;
            }
            seen.push(key);
            let mut req = request;
            req.collection_id = collection.id.clone();
            req.created_at = now_ms();
            req.updated_at = now_ms();
            ws.requests.push(req);
            imported += 1;
        }
        if let Some(col) = ws.collections.iter_mut().find(|c| c.id == collection.id) {
            col.updated_at = now_ms();
        }
        ImportResult {
            collection,
            imported,
            skipped,
            warnings: Vec::new(),
        }
    })
}

/* ------------------------------- environments ------------------------------ */

pub fn save_environment(env: Value) -> Result<Environment, String> {
    mutate(|ws| {
        let id = env.get("id").and_then(|v| v.as_str()).map(|s| s.to_string());
        let now = now_ms();
        if let Some(id) = id {
            if let Some(existing) = ws.environments.iter_mut().find(|e| e.id == id) {
                if let Some(name) = env.get("name").and_then(|v| v.as_str()) {
                    existing.name = name.to_string();
                }
                if let Some(vars) = env.get("variables") {
                    if let Ok(parsed) = serde_json::from_value::<Vec<EnvVar>>(vars.clone()) {
                        existing.variables = parsed;
                    }
                }
                existing.updated_at = now;
                return existing.clone();
            }
        }
        let created = Environment {
            id: new_id("env"),
            name: env
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("新环境")
                .to_string(),
            variables: env
                .get("variables")
                .and_then(|v| serde_json::from_value::<Vec<EnvVar>>(v.clone()).ok())
                .unwrap_or_default(),
            created_at: now,
            updated_at: now,
        };
        ws.environments.push(created.clone());
        created
    })
}

pub fn delete_environment(id: &str) -> Result<bool, String> {
    mutate(|ws| {
        let before = ws.environments.len();
        ws.environments.retain(|e| e.id != id);
        if ws.active_environment_id.as_deref() == Some(id) {
            ws.active_environment_id = None;
        }
        ws.environments.len() < before
    })
}

pub fn set_active_environment(id: Option<String>) -> Result<(), String> {
    mutate(|ws| {
        ws.active_environment_id = id;
    })
}

pub fn replace_workspace(next: Workspace) -> Result<Workspace, String> {
    mutate(|ws| {
        *ws = next;
    })?;
    Ok(read_workspace())
}

/* ----------------------------------- misc ---------------------------------- */

pub fn api_token() -> String {
    let file = data_dir().join("api-token");
    if let Ok(token) = fs::read_to_string(&file) {
        let trimmed = token.trim().to_string();
        if !trimmed.is_empty() {
            return trimmed;
        }
    }
    let token = crate::model::new_id("tok").replace("tok_", "");
    let _ = fs::create_dir_all(data_dir());
    let _ = fs::write(&file, &token);
    token
}

pub fn json_string(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string()
}
