use apitools_core::{exporters, http_client, importers, model::*, store};
use axum::{
    extract::{Path, Query, Request, State},
    http::{Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};

pub const DEFAULT_PORT: u16 = 4731;

#[derive(Clone)]
struct AppState {
    token: String,
}

type ApiResult = Result<Json<Value>, (StatusCode, Json<Value>)>;

fn err(status: StatusCode, message: impl Into<String>) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "error": message.into() })))
}

fn body_string(body: &Value, key: &str) -> Option<String> {
    body.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

async fn cors(req: Request, next: Next) -> Response {
    let is_options = req.method() == Method::OPTIONS;
    let mut response = if is_options {
        StatusCode::NO_CONTENT.into_response()
    } else {
        next.run(req).await
    };
    let headers = response.headers_mut();
    headers.insert("access-control-allow-origin", "*".parse().unwrap());
    headers.insert(
        "access-control-allow-headers",
        "content-type, x-apitools-token".parse().unwrap(),
    );
    headers.insert(
        "access-control-allow-methods",
        "GET,POST,PUT,PATCH,DELETE,OPTIONS".parse().unwrap(),
    );
    response
}

async fn auth(State(state): State<AppState>, req: Request, next: Next) -> Response {
    if req.method() == Method::OPTIONS {
        return next.run(req).await;
    }
    let header_token = req
        .headers()
        .get("x-apitools-token")
        .and_then(|value| value.to_str().ok())
        .map(|value| value == state.token)
        .unwrap_or(false);
    let query_token = req.uri().query().map(|query| {
        query
            .split('&')
            .any(|pair| pair == format!("token={}", state.token))
    });
    if header_token || query_token.unwrap_or(false) {
        next.run(req).await
    } else {
        err(
            StatusCode::UNAUTHORIZED,
            "unauthorized: 请在请求头带上 x-apitools-token",
        )
        .into_response()
    }
}

/* --------------------------------- handlers -------------------------------- */

async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "name": "apiTools", "version": "1.0.0", "engine": "rust" }))
}

async fn list_collections() -> ApiResult {
    let ws = store::read_workspace();
    let items: Vec<Value> = ws
        .collections
        .iter()
        .map(|collection| {
            let count = ws
                .requests
                .iter()
                .filter(|r| r.collection_id == collection.id)
                .count();
            json!({
                "id": collection.id,
                "name": collection.name,
                "description": collection.description,
                "createdAt": collection.created_at,
                "updatedAt": collection.updated_at,
                "requestCount": count
            })
        })
        .collect();
    Ok(Json(json!({ "collections": items })))
}

async fn create_collection_route(Json(body): Json<Value>) -> ApiResult {
    let name = body_string(&body, "name").ok_or_else(|| err(StatusCode::BAD_REQUEST, "name 不能为空"))?;
    let description = body_string(&body, "description").unwrap_or_default();
    let collection = store::create_collection(&name, &description).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(serde_json::to_value(collection).unwrap_or_default()))
}

async fn update_collection_route(
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    let name = body_string(&body, "name");
    let description = body_string(&body, "description");
    let updated = store::update_collection(&id, name, description)
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    match updated {
        Some(collection) => Ok(Json(serde_json::to_value(collection).unwrap())),
        None => Err(err(StatusCode::NOT_FOUND, "集合不存在")),
    }
}

async fn delete_collection_route(Path(id): Path<String>) -> ApiResult {
    let ok = store::delete_collection(&id).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(json!({ "ok": ok })))
}

async fn list_requests(Query(query): Query<HashMap<String, String>>) -> ApiResult {
    let requests = store::read_workspace().requests;
    let filtered: Vec<ApiRequest> = match query.get("collectionId") {
        Some(id) => requests.into_iter().filter(|r| &r.collection_id == id).collect(),
        None => requests,
    };
    Ok(Json(json!({ "requests": filtered })))
}

async fn get_request_route(Path(id): Path<String>) -> ApiResult {
    match store::get_request(&id) {
        Some(request) => Ok(Json(serde_json::to_value(request).unwrap())),
        None => Err(err(StatusCode::NOT_FOUND, "请求不存在")),
    }
}

async fn create_request_route(Json(body): Json<Value>) -> ApiResult {
    if body_string(&body, "url").is_none() {
        return Err(err(StatusCode::BAD_REQUEST, "url 不能为空"));
    }
    let request = store::upsert_request(body).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(serde_json::to_value(request).unwrap()))
}

async fn update_request_route(Path(id): Path<String>, Json(mut body): Json<Value>) -> ApiResult {
    if store::get_request(&id).is_none() {
        return Err(err(StatusCode::NOT_FOUND, "请求不存在"));
    }
    if let Value::Object(map) = &mut body {
        map.insert("id".into(), json!(id));
    }
    let request = store::upsert_request(body).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(serde_json::to_value(request).unwrap()))
}

async fn delete_request_route(Path(id): Path<String>) -> ApiResult {
    let ok = store::delete_request(&id).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(json!({ "ok": ok })))
}

async fn import_route(Json(body): Json<Value>) -> ApiResult {
    let Some(content) = body_string(&body, "content") else {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "content 不能为空（传入接口文档的原始文本）",
        ));
    };
    let format = body_string(&body, "format");
    let collection_name = body_string(&body, "collectionName");
    let replace = body_string(&body, "mode").as_deref() == Some("replace");

    let output = importers::import_content(&content, format.as_deref(), collection_name.as_deref())
        .map_err(|e| err(StatusCode::BAD_REQUEST, e))?;
    let detected = format.unwrap_or_else(|| importers::detect_format(&content).to_string());
    let mut result = store::apply_import(
        &output.collection_name,
        output.requests,
        &output.description,
        replace,
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    result.warnings.extend(output.warnings);
    let mut payload = serde_json::to_value(result).unwrap_or_default();
    if let Value::Object(map) = &mut payload {
        map.insert("format".into(), json!(detected));
    }
    Ok(Json(payload))
}

async fn export_route(Query(query): Query<HashMap<String, String>>) -> ApiResult {
    let format = query.get("format").cloned().unwrap_or_else(|| "postman".to_string());
    let Some(collection_id) = query.get("collectionId") else {
        let ws = store::read_workspace();
        return Ok(Json(json!({
            "format": "apitools",
            "filename": "workspace.apitools.json",
            "content": serde_json::to_string_pretty(&ws).unwrap_or_default()
        })));
    };
    let ws = store::read_workspace();
    let Some(collection) = ws.collections.iter().find(|c| &c.id == collection_id) else {
        return Err(err(StatusCode::NOT_FOUND, "集合不存在"));
    };
    let requests: Vec<ApiRequest> = ws
        .requests
        .into_iter()
        .filter(|r| &r.collection_id == collection_id)
        .collect();
    let output = exporters::export_collection(collection, &requests, &format);
    Ok(Json(serde_json::to_value(output).unwrap()))
}

async fn send_route(Json(body): Json<Value>) -> ApiResult {
    let Some(url) = body_string(&body, "url") else {
        return Err(err(StatusCode::BAD_REQUEST, "url 不能为空"));
    };
    let method = body_string(&body, "method").unwrap_or_else(|| "GET".to_string());
    let headers: BTreeMap<String, String> = body
        .get("headers")
        .and_then(|h| h.as_object())
        .map(|map| {
            map.iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|text| (key.clone(), text.to_string()))
                })
                .collect()
        })
        .unwrap_or_default();
    let payload = body_string(&body, "body").unwrap_or_default();
    let timeout = body.get("timeoutMs").and_then(|v| v.as_u64());

    let result = tokio::task::spawn_blocking(move || {
        http_client::execute(&method, &url, &headers, Some(&payload), timeout)
    })
    .await
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(serde_json::to_value(result).unwrap_or_default()))
}

async fn self_openapi() -> Json<Value> {
    Json(json!({
        "openapi": "3.0.3",
        "info": {
            "title": "apiTools Local REST API (Rust)",
            "version": "1.0.0",
            "description": "本地接口管理 API。所有请求需带 x-apitools-token 请求头。"
        },
        "servers": [{ "url": format!("http://127.0.0.1:{DEFAULT_PORT}") }],
        "paths": {
            "/health": { "get": { "summary": "健康检查", "responses": { "200": { "description": "OK" } } } },
            "/collections": {
                "get": { "summary": "列出集合", "responses": { "200": { "description": "OK" } } },
                "post": { "summary": "创建集合", "responses": { "201": { "description": "Created" } } }
            },
            "/collections/{id}": {
                "patch": { "summary": "更新集合", "responses": { "200": { "description": "OK" } } },
                "delete": { "summary": "删除集合", "responses": { "200": { "description": "OK" } } }
            },
            "/requests": {
                "get": { "summary": "列出接口", "responses": { "200": { "description": "OK" } } },
                "post": { "summary": "创建或更新接口", "responses": { "201": { "description": "Created" } } }
            },
            "/requests/{id}": {
                "put": { "summary": "更新接口", "responses": { "200": { "description": "OK" } } },
                "delete": { "summary": "删除接口", "responses": { "200": { "description": "OK" } } }
            },
            "/import": { "post": { "summary": "导入接口文档（openapi/postman/har/curl）", "responses": { "200": { "description": "OK" } } } },
            "/export": { "get": { "summary": "导出集合（postman/openapi/apitools）", "responses": { "200": { "description": "OK" } } } },
            "/send": { "post": { "summary": "代理发送 HTTP 请求", "responses": { "200": { "description": "OK" } } } }
        }
    }))
}

pub fn router(token: String) -> Router {
    let state = AppState { token };
    Router::new()
        .route("/health", get(health))
        .route("/collections", get(list_collections).post(create_collection_route))
        .route(
            "/collections/:id",
            axum::routing::patch(update_collection_route).delete(delete_collection_route),
        )
        .route("/requests", get(list_requests).post(create_request_route))
        .route(
            "/requests/:id",
            get(get_request_route)
                .put(update_request_route)
                .delete(delete_request_route),
        )
        .route("/import", post(import_route))
        .route("/export", get(export_route))
        .route("/send", post(send_route))
        .route("/openapi.json", get(self_openapi))
        .layer(middleware::from_fn_with_state(state.clone(), auth))
        .layer(middleware::from_fn(cors))
        .with_state(state)
}

pub async fn serve(port: u16) {
    let token = store::api_token();
    let app = router(token);
    let bind = if port == 0 { DEFAULT_PORT } else { port };
    match tokio::net::TcpListener::bind(("127.0.0.1", bind)).await {
        Ok(listener) => {
            eprintln!("[apitools] REST API listening on 127.0.0.1:{bind}");
            if let Err(err) = axum::serve(listener, app).await {
                eprintln!("[apitools] REST server error: {err}");
            }
        }
        Err(err) => eprintln!("[apitools] 无法绑定 127.0.0.1:{bind} -> {err}"),
    }
}
