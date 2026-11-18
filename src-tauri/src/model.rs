use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn new_id(prefix: &str) -> String {
    let r: u32 = rand::random();
    format!("{}_{:x}{:05x}", prefix, now_ms(), r % 0x100000)
}

fn default_true() -> bool {
    true
}

fn default_method() -> String {
    "GET".to_string()
}

fn default_body_type() -> String {
    "none".to_string()
}

fn default_auth_type() -> String {
    "none".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyValue {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

impl KeyValue {
    pub fn new(key: impl Into<String>, value: impl Into<String>) -> Self {
        KeyValue {
            id: new_id("kv"),
            key: key.into(),
            value: value.into(),
            enabled: true,
            description: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthConfig {
    #[serde(rename = "type", default = "default_auth_type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub add_to: Option<String>,
}

impl Default for AuthConfig {
    fn default() -> Self {
        AuthConfig {
            kind: "none".to_string(),
            token: None,
            username: None,
            password: None,
            key: None,
            value: None,
            add_to: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiRequest {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub collection_id: String,
    #[serde(default)]
    pub folder: String,
    #[serde(default)]
    pub name: String,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub params: Vec<KeyValue>,
    #[serde(default)]
    pub headers: Vec<KeyValue>,
    #[serde(default = "default_body_type")]
    pub body_type: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub auth: AuthConfig,
    #[serde(default)]
    pub description: String,
    #[serde(default = "now_ms")]
    pub created_at: u64,
    #[serde(default = "now_ms")]
    pub updated_at: u64,
}

impl Default for ApiRequest {
    fn default() -> Self {
        ApiRequest {
            id: new_id("req"),
            collection_id: String::new(),
            folder: String::new(),
            name: "未命名请求".to_string(),
            method: "GET".to_string(),
            url: String::new(),
            params: Vec::new(),
            headers: Vec::new(),
            body_type: "none".to_string(),
            body: String::new(),
            auth: AuthConfig::default(),
            description: String::new(),
            created_at: now_ms(),
            updated_at: now_ms(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    #[serde(default = "collection_id_default")]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "now_ms")]
    pub created_at: u64,
    #[serde(default = "now_ms")]
    pub updated_at: u64,
}

pub fn collection_id_default() -> String {
    new_id("col")
}

impl Collection {
    pub fn new(name: impl Into<String>, description: impl Into<String>) -> Self {
        Collection {
            id: new_id("col"),
            name: name.into(),
            description: description.into(),
            created_at: now_ms(),
            updated_at: now_ms(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVar {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    #[serde(default = "env_id_default")]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub variables: Vec<EnvVar>,
    #[serde(default = "now_ms")]
    pub created_at: u64,
    #[serde(default = "now_ms")]
    pub updated_at: u64,
}

pub fn env_id_default() -> String {
    new_id("env")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    #[serde(default = "version_default")]
    pub version: u32,
    #[serde(default)]
    pub collections: Vec<Collection>,
    #[serde(default)]
    pub requests: Vec<ApiRequest>,
    #[serde(default)]
    pub environments: Vec<Environment>,
    #[serde(default)]
    pub active_environment_id: Option<String>,
    #[serde(default = "now_ms")]
    pub updated_at: u64,
}

fn version_default() -> u32 {
    1
}

impl Default for Workspace {
    fn default() -> Self {
        Workspace {
            version: 1,
            collections: Vec::new(),
            requests: Vec::new(),
            environments: Vec::new(),
            active_environment_id: None,
            updated_at: now_ms(),
        }
    }
}

/* ------------------------------ io structures ----------------------------- */

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOutput {
    pub collection_name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub requests: Vec<ApiRequest>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub collection: Collection,
    pub imported: usize,
    pub skipped: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOutput {
    pub format: String,
    pub filename: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendResponse {
    pub ok: bool,
    pub status: u16,
    pub status_text: String,
    pub headers: std::collections::BTreeMap<String, String>,
    pub body: String,
    pub body_kind: String,
    pub size: usize,
    pub time_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl SendResponse {
    pub fn failure(message: impl Into<String>, time_ms: u64) -> Self {
        SendResponse {
            ok: false,
            status: 0,
            status_text: String::new(),
            headers: Default::default(),
            body: String::new(),
            body_kind: "text".to_string(),
            size: 0,
            time_ms,
            error: Some(message.into()),
        }
    }
}
