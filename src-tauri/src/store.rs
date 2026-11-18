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

/* --------------------------------- storage --------------------------------- */

fn normalize_stored(mut stored: StoredWorkspace) -> StoredWorkspace {
    if stored.projects.is_empty() {
        let project = Project::new("默认项目", "");
        stored.active_project_id = Some(project.id.clone());
        stored.projects.push(project);
    }
    let valid = stored
        .active_project_id
        .as_ref()
        .map(|id| stored.projects.iter().any(|p| &p.id == id))
        .unwrap_or(false);
    if !valid {
        stored.active_project_id = stored.projects.first().map(|p| p.id.clone());
    }
    // 旧数据迁移：环境里的 baseUrl 变量升级为「统一 URL 前缀」
    for project in stored.projects.iter_mut() {
        for env in project.environments.iter_mut() {
            if env.base_url.trim().is_empty() {
                if let Some(found) = env.variables.iter().find(|variable| {
                    variable.enabled
                        && !variable.value.trim().is_empty()
                        && matches!(
                            variable.key.to_lowercase().as_str(),
                            "baseurl" | "base_url" | "url" | "host"
                        )
                }) {
                    env.base_url = found.value.clone();
                }
            }
        }
    }
    stored.version = 2;
    stored
}

/// 读取落盘结构，自动把 v1（单工作区）迁移成「默认项目」
pub fn read_stored() -> StoredWorkspace {
    let Ok(raw) = fs::read_to_string(data_file()) else {
        return normalize_stored(StoredWorkspace::default());
    };
    if raw.trim().is_empty() {
        return normalize_stored(StoredWorkspace::default());
    }
    let Ok(value) = serde_json::from_str::<Value>(&raw) else {
        return normalize_stored(StoredWorkspace::default());
    };
    if value.get("projects").is_some() {
        let stored: StoredWorkspace = serde_json::from_value(value).unwrap_or_default();
        normalize_stored(stored)
    } else {
        let legacy: Workspace = serde_json::from_value(value).unwrap_or_default();
        let project = Project {
            id: new_id("prj"),
            name: "默认项目".to_string(),
            description: String::new(),
            collections: legacy.collections,
            requests: legacy.requests,
            environments: legacy.environments,
            active_environment_id: legacy.active_environment_id,
            created_at: now_ms(),
            updated_at: now_ms(),
        };
        normalize_stored(StoredWorkspace {
            version: 2,
            projects: vec![project],
            active_project_id: None,
            updated_at: now_ms(),
        })
    }
}

fn write_stored(stored: &StoredWorkspace) -> Result<(), String> {
    let mut next = stored.clone();
    next.updated_at = now_ms();
    next.version = 2;
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
    Ok(())
}

fn active_index(stored: &StoredWorkspace) -> usize {
    if let Some(id) = &stored.active_project_id {
        if let Some(index) = stored.projects.iter().position(|p| &p.id == id) {
            return index;
        }
    }
    0
}

/// 在当前项目上执行修改并落盘
pub fn mutate<T>(f: impl FnOnce(&mut Project) -> T) -> Result<T, String> {
    let _guard = acquire_lock()?;
    let mut stored = read_stored();
    let index = active_index(&stored);
    let output = {
        let project = &mut stored.projects[index];
        let result = f(project);
        project.updated_at = now_ms();
        result
    };
    write_stored(&stored)?;
    Ok(output)
}

/// 前端视图：项目列表 + 当前项目内容
pub fn snapshot() -> Workspace {
    let stored = read_stored();
    let index = active_index(&stored);
    let project = &stored.projects[index];
    Workspace {
        version: 2,
        projects: stored
            .projects
            .iter()
            .map(|p| ProjectSummary {
                id: p.id.clone(),
                name: p.name.clone(),
                description: p.description.clone(),
                collection_count: p.collections.len(),
                request_count: p.requests.len(),
                created_at: p.created_at,
                updated_at: p.updated_at,
            })
            .collect(),
        active_project_id: Some(project.id.clone()),
        collections: project.collections.clone(),
        requests: project.requests.clone(),
        environments: project.environments.clone(),
        active_environment_id: project.active_environment_id.clone(),
        updated_at: stored.updated_at,
    }
}

/// 兼容旧调用：等同于当前项目视图
pub fn read_workspace() -> Workspace {
    snapshot()
}

/* --------------------------------- projects -------------------------------- */

pub fn create_project(name: &str, description: &str) -> Result<ProjectSummary, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("项目名称不能为空".to_string());
    }
    let _guard = acquire_lock()?;
    let mut stored = read_stored();
    let project = Project::new(name, description);
    let summary = ProjectSummary {
        id: project.id.clone(),
        name: project.name.clone(),
        description: project.description.clone(),
        collection_count: 0,
        request_count: 0,
        created_at: project.created_at,
        updated_at: project.updated_at,
    };
    stored.projects.push(project);
    stored.active_project_id = Some(summary.id.clone());
    write_stored(&stored)?;
    Ok(summary)
}

pub fn rename_project(id: &str, name: &str, description: Option<String>) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("项目名称不能为空".to_string());
    }
    let _guard = acquire_lock()?;
    let mut stored = read_stored();
    if let Some(project) = stored.projects.iter_mut().find(|p| p.id == id) {
        project.name = name;
        if let Some(description) = description {
            project.description = description;
        }
        project.updated_at = now_ms();
    }
    write_stored(&stored)?;
    Ok(())
}

pub fn delete_project(id: &str) -> Result<bool, String> {
    let _guard = acquire_lock()?;
    let mut stored = read_stored();
    if stored.projects.len() <= 1 {
        return Err("至少保留一个项目".to_string());
    }
    let before = stored.projects.len();
    stored.projects.retain(|p| p.id != id);
    if stored.active_project_id.as_deref() == Some(id) {
        stored.active_project_id = stored.projects.first().map(|p| p.id.clone());
    }
    write_stored(&stored)?;
    Ok(stored.projects.len() < before)
}

pub fn set_active_project(id: &str) -> Result<(), String> {
    let _guard = acquire_lock()?;
    let mut stored = read_stored();
    if !stored.projects.iter().any(|p| p.id == id) {
        return Err("项目不存在".to_string());
    }
    stored.active_project_id = Some(id.to_string());
    write_stored(&stored)?;
    Ok(())
}

/* ------------------------------- collections ------------------------------- */

fn ensure_collection(project: &mut Project, name: &str) -> Collection {
    if let Some(found) = project.collections.iter().find(|c| c.name == name) {
        return found.clone();
    }
    let collection = Collection::new(name, "");
    project.collections.push(collection.clone());
    collection
}

pub fn create_collection(name: &str, description: &str) -> Result<Collection, String> {
    mutate(|project| {
        let collection = Collection::new(name, description);
        project.collections.push(collection.clone());
        collection
    })
}

pub fn update_collection(
    id: &str,
    name: Option<String>,
    description: Option<String>,
) -> Result<Option<Collection>, String> {
    mutate(|project| {
        let Some(col) = project.collections.iter_mut().find(|c| c.id == id) else {
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
    mutate(|project| {
        let before = project.collections.len();
        project.collections.retain(|c| c.id != id);
        project.requests.retain(|r| r.collection_id != id);
        project.collections.len() < before
    })
}

/* ---------------------------------- folders -------------------------------- */

pub fn create_folder(collection_id: &str, name: &str) -> Result<Vec<String>, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("目录名不能为空".to_string());
    }
    mutate(|project| match project.collections.iter_mut().find(|c| c.id == collection_id) {
        Some(col) => {
            if !col.folders.contains(&name) {
                col.folders.push(name.clone());
            }
            col.updated_at = now_ms();
            Ok(col.folders.clone())
        }
        None => Err("集合不存在".to_string()),
    })?
}

pub fn rename_folder(
    collection_id: &str,
    old_name: &str,
    new_name: &str,
) -> Result<Vec<String>, String> {
    let new_name = new_name.trim().to_string();
    if new_name.is_empty() {
        return Err("目录名不能为空".to_string());
    }
    mutate(|project| match project.collections.iter_mut().find(|c| c.id == collection_id) {
        Some(col) => {
            let child_prefix = format!("{old_name}/");
            for folder in col.folders.iter_mut() {
                if folder == old_name {
                    *folder = new_name.clone();
                } else if let Some(rest) = folder.strip_prefix(&child_prefix) {
                    *folder = format!("{new_name}/{rest}");
                }
            }
            col.updated_at = now_ms();
            let folders = col.folders.clone();
            for request in project.requests.iter_mut() {
                if request.collection_id != collection_id {
                    continue;
                }
                if request.folder == old_name {
                    request.folder = new_name.clone();
                } else if let Some(rest) = request.folder.strip_prefix(&child_prefix) {
                    request.folder = format!("{new_name}/{rest}");
                }
            }
            Ok(folders)
        }
        None => Err("集合不存在".to_string()),
    })?
}

pub fn delete_folder(collection_id: &str, name: &str) -> Result<Vec<String>, String> {
    mutate(|project| match project.collections.iter_mut().find(|c| c.id == collection_id) {
        Some(col) => {
            // 支持多级目录：同时删除其子目录
            let prefix = format!("{name}/");
            col.folders
                .retain(|folder| folder != name && !folder.starts_with(&prefix));
            col.updated_at = now_ms();
            let folders = col.folders.clone();
            for request in project.requests.iter_mut() {
                if request.collection_id == collection_id
                    && (request.folder == name || request.folder.starts_with(&prefix))
                {
                    request.folder.clear();
                }
            }
            Ok(folders)
        }
        None => Err("集合不存在".to_string()),
    })?
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
    mutate(|project| {
        let collection_name = input
            .get("collectionName")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let collection_id = input
            .get("collectionId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let collection = match collection_name {
            Some(name) => ensure_collection(project, &name),
            None => match collection_id {
                Some(id) => project
                    .collections
                    .iter()
                    .find(|c| c.id == id)
                    .cloned()
                    .unwrap_or_else(|| ensure_collection(project, "默认集合")),
                None => ensure_collection(project, "默认集合"),
            },
        };

        let existing_index = input
            .get("id")
            .and_then(|v| v.as_str())
            .and_then(|id| project.requests.iter().position(|r| r.id == id));

        let base = match existing_index {
            Some(index) => project.requests[index].clone(),
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
            project.requests[index] = request.clone();
        } else {
            project.requests.push(request.clone());
        }
        if let Some(col) = project.collections.iter_mut().find(|c| c.id == collection.id) {
            col.updated_at = now_ms();
        }
        request
    })
}

pub fn delete_request(id: &str) -> Result<bool, String> {
    mutate(|project| {
        let before = project.requests.len();
        project.requests.retain(|r| r.id != id);
        project.requests.len() < before
    })
}

pub fn get_request(id: &str) -> Option<ApiRequest> {
    snapshot().requests.into_iter().find(|r| r.id == id)
}

/* ---------------------------------- import --------------------------------- */

pub fn apply_import(
    collection_name: &str,
    requests: Vec<ApiRequest>,
    description: &str,
    replace: bool,
) -> Result<ImportResult, String> {
    mutate(|project| {
        let collection = ensure_collection(project, collection_name);
        if !description.is_empty() {
            if let Some(col) = project.collections.iter_mut().find(|c| c.id == collection.id) {
                if col.description.is_empty() {
                    col.description = description.to_string();
                }
            }
        }
        if replace {
            project.requests.retain(|r| r.collection_id != collection.id);
        }
        let mut seen: Vec<String> = project
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
            project.requests.push(req);
            imported += 1;
        }
        if let Some(col) = project.collections.iter_mut().find(|c| c.id == collection.id) {
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
    let base_url = env.get("baseUrl").and_then(|v| v.as_str()).map(|s| s.to_string());
    let headers: Option<Vec<KeyValue>> = env
        .get("headers")
        .and_then(|v| serde_json::from_value(v.clone()).ok());
    let variables: Option<Vec<EnvVar>> = env
        .get("variables")
        .and_then(|v| serde_json::from_value(v.clone()).ok());

    mutate(|project| {
        let id = env.get("id").and_then(|v| v.as_str()).map(|s| s.to_string());
        let now = now_ms();
        if let Some(id) = id {
            if let Some(existing) = project.environments.iter_mut().find(|e| e.id == id) {
                if let Some(name) = env.get("name").and_then(|v| v.as_str()) {
                    existing.name = name.to_string();
                }
                if let Some(base_url) = base_url.clone() {
                    existing.base_url = base_url;
                }
                if let Some(headers) = headers.clone() {
                    existing.headers = headers;
                }
                if let Some(variables) = variables.clone() {
                    existing.variables = variables;
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
            base_url: base_url.unwrap_or_default(),
            headers: headers.unwrap_or_default(),
            variables: variables.unwrap_or_default(),
            created_at: now,
            updated_at: now,
        };
        project.environments.push(created.clone());
        created
    })
}

pub fn delete_environment(id: &str) -> Result<bool, String> {
    mutate(|project| {
        let before = project.environments.len();
        project.environments.retain(|e| e.id != id);
        if project.active_environment_id.as_deref() == Some(id) {
            project.active_environment_id = None;
        }
        project.environments.len() < before
    })
}

pub fn set_active_environment(id: Option<String>) -> Result<(), String> {
    mutate(|project| {
        project.active_environment_id = id;
    })
}

pub fn replace_workspace(next: Workspace) -> Result<Workspace, String> {
    mutate(|project| {
        project.collections = next.collections;
        project.requests = next.requests;
        project.environments = next.environments;
        project.active_environment_id = next.active_environment_id;
    })?;
    Ok(snapshot())
}

/* ----------------------------------- misc ---------------------------------- */

pub fn settings_file() -> PathBuf {
    data_dir().join("settings.json")
}

pub fn read_settings() -> AppSettings {
    fs::read_to_string(settings_file())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn write_settings(settings: &AppSettings) -> Result<(), String> {
    fs::create_dir_all(data_dir()).map_err(|e| format!("创建数据目录失败: {e}"))?;
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(settings_file(), text).map_err(|e| format!("写入设置失败: {e}"))
}

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
