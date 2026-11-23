use crate::http_client;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const MAX_CONCURRENCY: usize = 500;
const PUSH_INTERVAL_MS: u64 = 200;
const HISTOGRAM_MAX_MS: usize = 60_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadTestConfig {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub form_fields: Option<Vec<crate::model::FormField>>,
    #[serde(default = "default_concurrency")]
    pub concurrency: usize,
    #[serde(default)]
    pub duration_ms: Option<u64>,
    #[serde(default)]
    pub total_requests: Option<u64>,
    /// 速率模式：unlimited / fixed / random
    #[serde(default)]
    pub rate_mode: Option<String>,
    /// 固定模式下的目标 TPS（0 表示不限速）
    #[serde(default)]
    pub target_rps: u64,
    /// 随机模式：最小 / 最大 TPS
    #[serde(default)]
    pub min_rps: u64,
    #[serde(default)]
    pub max_rps: u64,
    /// 随机模式：每隔多少秒重新采样一次速率
    #[serde(default = "default_change_secs")]
    pub rps_change_secs: u64,
    /// 报文池 zip：解压后每份文件作为一次请求体，按文件名顺序轮询
    #[serde(default)]
    pub body_pool_zip: Option<String>,
    /// 变量 CSV：表头为变量名，每行一组值，按行轮询
    #[serde(default)]
    pub variables_csv: Option<String>,
    #[serde(default)]
    pub ramp_up_ms: u64,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

fn default_concurrency() -> usize {
    10
}

fn default_change_secs() -> u64 {
    5
}

/// 读取 zip 报文池：过滤目录与 macOS 元数据，按文件名排序
pub fn load_body_pool(path: &str) -> Result<Vec<Vec<u8>>, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("打开 zip 失败: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("解析 zip 失败: {e}"))?;
    let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
    let mut total: usize = 0;
    for index in 0..archive.len() {
        let mut item = archive
            .by_index(index)
            .map_err(|e| format!("读取 zip 条目失败: {e}"))?;
        if item.is_dir() {
            continue;
        }
        let name = item.name().to_string();
        if name.starts_with("__MACOSX/") || name.rsplit('/').next().unwrap_or("").starts_with("._") {
            continue;
        }
        let mut buffer = Vec::new();
        std::io::Read::read_to_end(&mut item, &mut buffer)
            .map_err(|e| format!("读取 {name} 失败: {e}"))?;
        total += buffer.len();
        if total > 200 * 1024 * 1024 {
            return Err("报文池总大小超过 200MB，请拆分后再压测".to_string());
        }
        entries.push((name, buffer));
    }
    if entries.is_empty() {
        return Err("zip 中没有可用报文文件".to_string());
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(entries.into_iter().map(|(_, bytes)| bytes).collect())
}

pub fn body_pool_info(path: &str) -> Result<(usize, usize), String> {
    let pool = load_body_pool(path)?;
    let bytes = pool.iter().map(|item| item.len()).sum();
    Ok((pool.len(), bytes))
}

/// 替换 ${name} 形式的变量；未定义的原样保留
pub fn substitute_vars(text: &str, vars: &std::collections::HashMap<String, String>) -> String {
    if vars.is_empty() || !text.contains("${") {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find('}') {
            Some(end) => {
                let key = &after[..end];
                match vars.get(key) {
                    Some(value) => out.push_str(value),
                    None => out.push_str(&rest[start..start + 2 + end + 1]),
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// 报文可能是二进制，能按 UTF-8 解码才做变量替换
fn substitute_bytes(bytes: Vec<u8>, vars: &std::collections::HashMap<String, String>) -> Vec<u8> {
    if vars.is_empty() {
        return bytes;
    }
    match String::from_utf8(bytes) {
        Ok(text) => substitute_vars(&text, vars).into_bytes(),
        Err(err) => err.into_bytes(),
    }
}

fn rate_mode_of(config: &LoadTestConfig) -> &'static str {
    match config.rate_mode.as_deref() {
        Some("random") => "random",
        Some("fixed") => "fixed",
        Some("unlimited") => "unlimited",
        _ => {
            if config.target_rps > 0 || config.min_rps > 0 || config.max_rps > 0 {
                if config.min_rps > 0 && config.max_rps > 0 {
                    "random"
                } else {
                    "fixed"
                }
            } else {
                "unlimited"
            }
        }
    }
}

static RAND_STATE: AtomicU64 = AtomicU64::new(0x2545F4914F6CDD1D);

fn next_rand() -> u64 {
    let mut x = RAND_STATE.fetch_add(0x9E3779B97F4A7C15, Ordering::Relaxed)
        ^ (crate::model::now_ms() as u64).wrapping_mul(0x2545F4914F6CDD1D);
    x ^= x >> 30;
    x = x.wrapping_mul(0xBF58476D1CE4E5B9);
    x ^= x >> 27;
    x = x.wrapping_mul(0x94D049BB133111EB);
    x ^ (x >> 31)
}

fn rand_between(min: u64, max: u64) -> u64 {
    if max <= min {
        return min;
    }
    min + next_rand() % (max - min + 1)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlowRequest {
    pub ms: u64,
    pub status: u16,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadTestSnapshot {
    pub running: bool,
    pub elapsed_ms: u64,
    pub total: u64,
    pub success: u64,
    pub failed: u64,
    pub errors: BTreeMap<String, u64>,
    pub status_classes: BTreeMap<String, u64>,
    pub qps: f64,
    pub avg_ms: f64,
    pub p50: u64,
    pub p90: u64,
    pub p95: u64,
    pub p99: u64,
    pub min_ms: u64,
    pub max_ms: u64,
    pub bytes_per_sec: f64,
    /// 延迟直方图：(桶下界 ms, 数量)
    pub buckets: Vec<(u64, u64)>,
    pub slowest: Vec<SlowRequest>,
    pub concurrency: usize,
    /// 当前生效的目标 TPS（0 = 不限速）
    pub target_rps: u64,
}

struct Metrics {
    total: u64,
    success: u64,
    failed: u64,
    bytes: u64,
    errors: BTreeMap<String, u64>,
    status_classes: BTreeMap<String, u64>,
    histogram: Vec<u32>,
    min_ms: u64,
    max_ms: u64,
    slowest: Vec<SlowRequest>,
}

impl Metrics {
    fn new() -> Self {
        Metrics {
            total: 0,
            success: 0,
            failed: 0,
            bytes: 0,
            errors: BTreeMap::new(),
            status_classes: BTreeMap::new(),
            histogram: vec![0; HISTOGRAM_MAX_MS + 1],
            min_ms: u64::MAX,
            max_ms: 0,
            slowest: Vec::new(),
        }
    }

    fn record(&mut self, status: u16, ms: u64, bytes: usize, error: Option<String>) {
        self.total += 1;
        self.bytes += bytes as u64;
        if error.is_none() && (200..400).contains(&status) {
            self.success += 1;
        } else {
            self.failed += 1;
        }
        let class = if error.is_some() {
            "error"
        } else if status >= 500 {
            "5xx"
        } else if status >= 400 {
            "4xx"
        } else if status >= 300 {
            "3xx"
        } else {
            "2xx"
        };
        *self.status_classes.entry(class.to_string()).or_insert(0) += 1;
        if let Some(message) = &error {
            let key = if message.contains("timed out") || message.contains("timeout") {
                "超时".to_string()
            } else if message.contains("Connection refused") {
                "连接被拒绝".to_string()
            } else if message.contains("connect") || message.contains("Connection") {
                "连接失败".to_string()
            } else {
                // 去掉 "url: Network Error: xxx" 这类前缀，只保留原因
                let reason = message.rsplit(": ").next().unwrap_or(message.as_str()).trim();
                let reason = if reason.is_empty() { message.as_str() } else { reason };
                reason.chars().take(48).collect::<String>()
            };
            *self.errors.entry(key).or_insert(0) += 1;
        }
        let bucket = (ms.min(HISTOGRAM_MAX_MS as u64)) as usize;
        self.histogram[bucket] += 1;
        self.min_ms = self.min_ms.min(ms);
        self.max_ms = self.max_ms.max(ms);
        if self.slowest.len() < 10 || ms > self.slowest.last().map(|s| s.ms).unwrap_or(0) {
            self.slowest.push(SlowRequest {
                ms,
                status,
                error: error.clone(),
            });
            self.slowest.sort_by(|a, b| b.ms.cmp(&a.ms));
            self.slowest.truncate(10);
        }
    }

    fn percentile(&self, p: f64) -> u64 {
        let total: u64 = self.total;
        if total == 0 {
            return 0;
        }
        let target = ((total as f64) * p).ceil() as u64;
        let mut seen = 0u64;
        for (ms, count) in self.histogram.iter().enumerate() {
            seen += *count as u64;
            if seen >= target {
                return ms as u64;
            }
        }
        0
    }

    fn buckets(&self) -> Vec<(u64, u64)> {
        // 固定梯度分桶，比等宽分桶更能反映真实延迟分布
        const EDGES: [u64; 15] = [0, 1, 2, 3, 5, 8, 12, 20, 35, 60, 100, 200, 500, 1_000, 5_000];
        let mut buckets = vec![0u64; EDGES.len()];
        for (ms, count) in self.histogram.iter().enumerate() {
            if *count == 0 {
                continue;
            }
            let value = ms as u64;
            let index = EDGES
                .iter()
                .rposition(|edge| *edge <= value)
                .unwrap_or(0);
            buckets[index] += *count as u64;
        }
        EDGES.iter().copied().zip(buckets).collect()
    }

    fn snapshot(
        &self,
        running: bool,
        elapsed_ms: u64,
        concurrency: usize,
        target_rps: u64,
    ) -> LoadTestSnapshot {
        let seconds = (elapsed_ms as f64 / 1000.0).max(0.001);
        let avg = if self.total > 0 {
            let sum: u64 = self
                .histogram
                .iter()
                .enumerate()
                .map(|(ms, count)| ms as u64 * (*count as u64))
                .sum();
            sum as f64 / self.total as f64
        } else {
            0.0
        };
        LoadTestSnapshot {
            running,
            elapsed_ms,
            total: self.total,
            success: self.success,
            failed: self.failed,
            errors: self.errors.clone(),
            status_classes: self.status_classes.clone(),
            qps: self.total as f64 / seconds,
            avg_ms: avg,
            p50: self.percentile(0.5),
            p90: self.percentile(0.9),
            p95: self.percentile(0.95),
            p99: self.percentile(0.99),
            min_ms: if self.min_ms == u64::MAX { 0 } else { self.min_ms },
            max_ms: self.max_ms,
            bytes_per_sec: self.bytes as f64 / seconds,
            buckets: self.buckets(),
            slowest: self.slowest.clone(),
            concurrency,
            target_rps,
        }
    }
}

pub struct LoadTestHandle {
    pub stop: Arc<AtomicBool>,
}

static CURRENT: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);

pub fn stop_current() {
    if let Ok(guard) = CURRENT.lock() {
        if let Some(flag) = guard.as_ref() {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

fn request_parts(config: &LoadTestConfig) -> (BTreeMap<String, String>, Option<String>, Vec<http_client::FormPart>) {
    let headers = config.headers.clone();
    let body = config.body.clone();
    let parts: Vec<http_client::FormPart> = config
        .form_fields
        .clone()
        .unwrap_or_default()
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
        .collect();
    (headers, body, parts)
}

/// 跑一轮压测，期间每 200ms 通过事件推送一次快照
pub async fn run(
    app: tauri::AppHandle,
    config: LoadTestConfig,
    body_pool: Arc<Vec<Vec<u8>>>,
    csv_vars: Arc<(Vec<String>, Vec<Vec<String>>)>,
) {
    use tauri::Emitter;

    let concurrency = config.concurrency.clamp(1, MAX_CONCURRENCY);
    let stop = Arc::new(AtomicBool::new(false));
    let sent = Arc::new(AtomicU64::new(0));
    if let Ok(mut guard) = CURRENT.lock() {
        *guard = Some(stop.clone());
    }

    let metrics = Arc::new(Mutex::new(Metrics::new()));
    let current_rate = Arc::new(AtomicU64::new(0));
    let started = Instant::now();

    // 速率控制器：固定模式只设一次，随机模式按间隔重新采样，模拟生产流量波动
    let controller = {
        let config_rate = config.clone();
        let rate = current_rate.clone();
        let stop_controller = stop.clone();
        tauri::async_runtime::spawn(async move {
            let mode = rate_mode_of(&config_rate);
            let interval = Duration::from_secs(config_rate.rps_change_secs.max(1));
            loop {
                if stop_controller.load(Ordering::Relaxed) {
                    break;
                }
                let value = match mode {
                    "random" => {
                        let min = config_rate.min_rps.max(1);
                        let max = config_rate.max_rps.max(min);
                        rand_between(min, max)
                    }
                    "fixed" => config_rate.target_rps,
                    _ => 0,
                };
                rate.store(value, Ordering::Relaxed);
                if mode != "random" {
                    break;
                }
                tokio::time::sleep(interval).await;
            }
        })
    };

    let deadline = config
        .duration_ms
        .map(|ms| started + Duration::from_millis(ms.max(500)));
    let (headers, body, parts) = request_parts(&config);
    let config = Arc::new(config);

    let mut handles = Vec::new();
    for index in 0..concurrency {
        let worker_stop = stop.clone();
        let worker_sent = sent.clone();
        let worker_metrics = metrics.clone();
        let worker_rate = current_rate.clone();
        let worker_config = config.clone();
        let worker_headers = headers.clone();
        let worker_body = body.clone();
        let worker_parts = parts.clone();
        let worker_pool = body_pool.clone();
        let worker_csv = csv_vars.clone();
        let ramp = if config.ramp_up_ms > 0 {
            Duration::from_millis(config.ramp_up_ms * index as u64 / concurrency.max(1) as u64)
        } else {
            Duration::ZERO
        };

        handles.push(tauri::async_runtime::spawn(async move {
            if !ramp.is_zero() {
                tokio::time::sleep(ramp).await;
            }
            loop {
                if worker_stop.load(Ordering::Relaxed) {
                    break;
                }
                if let Some(limit) = worker_config.total_requests {
                    if worker_sent.load(Ordering::Relaxed) >= limit {
                        break;
                    }
                }
                if let Some(deadline) = deadline {
                    if Instant::now() >= deadline {
                        break;
                    }
                }
                let sent_index = worker_sent.fetch_add(1, Ordering::Relaxed);

                // 变量：CSV 按行轮询，表头为变量名
                // 报文池每转完一轮再换下一行，避免两者数量相同时被绑成固定组合
                let (csv_headers, csv_rows) = worker_csv.as_ref();
                let vars: std::collections::HashMap<String, String> = if csv_rows.is_empty() {
                    std::collections::HashMap::new()
                } else {
                    let pool_len = worker_pool.len().max(1);
                    let row = &csv_rows[((sent_index as usize) / pool_len) % csv_rows.len()];
                    csv_headers
                        .iter()
                        .zip(row.iter())
                        .filter(|(key, _)| !key.trim().is_empty())
                        .map(|(key, value)| (key.trim().to_string(), value.clone()))
                        .collect()
                };
                let vars = &vars;

                let method = worker_config.method.clone();
                // 变量替换后再发送
                let url = substitute_vars(&worker_config.url, vars);
                let headers: BTreeMap<String, String> = worker_headers
                    .iter()
                    .map(|(key, value)| {
                        (
                            substitute_vars(key, vars),
                            substitute_vars(value, vars),
                        )
                    })
                    .collect();
                // 有报文池时按顺序轮询取一份，否则用面板里的请求体
                let payload: Option<Vec<u8>> = if worker_pool.is_empty() {
                    worker_body.as_ref().map(|text| text.as_bytes().to_vec())
                } else {
                    Some(worker_pool[(sent_index as usize) % worker_pool.len()].clone())
                };
                let payload = payload.map(|bytes| substitute_bytes(bytes, vars));
                let parts = worker_parts.clone();
                let timeout = worker_config.timeout_ms;

                let begin = Instant::now();
                let result = tokio::task::spawn_blocking(move || {
                    if !parts.is_empty() {
                        http_client::execute_multipart(&method, &url, &headers, &parts, timeout)
                    } else {
                        match payload {
                            Some(bytes) => {
                                http_client::execute_raw(&method, &url, &headers, bytes, timeout)
                            }
                            None => {
                                http_client::execute(&method, &url, &headers, None, timeout)
                            }
                        }
                    }
                })
                .await;

                let elapsed = begin.elapsed().as_millis() as u64;
                let (status, size, error) = match result {
                    Ok(response) => (response.status, response.size, response.error),
                    Err(join_error) => (0, 0, Some(format!("任务失败: {join_error}"))),
                };
                if let Ok(mut guard) = worker_metrics.lock() {
                    guard.record(status, elapsed, size, error);
                }

                let rate = worker_rate.load(Ordering::Relaxed);
                if rate > 0 {
                    let per_worker = (rate as f64 / concurrency as f64).max(0.25);
                    let base_micros = (1_000_000.0 / per_worker) as u64;
                    // ±25% 抖动，让请求间隔不那么机械
                    let jitter = 0.9 + (next_rand() % 2000) as f64 / 10_000.0;
                    let wait = (base_micros as f64 * jitter) as u64;
                    if wait > 0 {
                        tokio::time::sleep(Duration::from_micros(wait)).await;
                    }
                }
            }
        }));
    }

    // 定时推送快照，直到所有 worker 结束
    let metrics_push = metrics.clone();
    let rate_push = current_rate.clone();
    let app_push = app.clone();
    let stop_push = stop.clone();
    let push_task = tauri::async_runtime::spawn(async move {
        let mut window: std::collections::VecDeque<(Instant, u64)> =
            std::collections::VecDeque::new();
        window.push_back((Instant::now(), 0u64));
        loop {
            tokio::time::sleep(Duration::from_millis(PUSH_INTERVAL_MS)).await;
            let measured = metrics_push.lock().map(|guard| {
                let total = guard.total;
                (
                    total,
                    guard.snapshot(
                        !stop_push.load(Ordering::Relaxed),
                        started.elapsed().as_millis() as u64,
                        concurrency,
                        rate_push.load(Ordering::Relaxed),
                    ),
                )
            });
            if let Ok((total, mut snapshot)) = measured {
                // 1 秒滑动窗口的 QPS：既能反映随机速率的台阶，又不会太抖
                let now = Instant::now();
                window.push_back((now, total));
                while window.len() > 2
                    && now.duration_since(window.front().unwrap().0) > Duration::from_millis(1000)
                {
                    window.pop_front();
                }
                let (start_at, start_total) = *window.front().unwrap();
                let span = now.duration_since(start_at).as_secs_f64().max(0.05);
                snapshot.qps = total.saturating_sub(start_total) as f64 / span;
                let _ = app_push.emit("loadtest-progress", snapshot);
            }
            if stop_push.load(Ordering::Relaxed) {
                break;
            }
        }
    });

    for handle in handles {
        let _ = handle.await;
    }
    stop.store(true, Ordering::Relaxed);
    let _ = controller.await;
    let _ = push_task.await;

    // 最终快照
    if let Ok(guard) = metrics.lock() {
        let snapshot = guard.snapshot(
            false,
            started.elapsed().as_millis() as u64,
            concurrency,
            current_rate.load(Ordering::Relaxed),
        );
        let _ = app.emit("loadtest-progress", snapshot.clone());
        let _ = app.emit("loadtest-finished", snapshot);
    }
    if let Ok(mut guard) = CURRENT.lock() {
        *guard = None;
    }
}

pub fn validate(config: &LoadTestConfig) -> Result<(), String> {
    if config.concurrency == 0 || config.concurrency > MAX_CONCURRENCY {
        return Err(format!("并发数需在 1-{MAX_CONCURRENCY} 之间"));
    }
    if !(config.url.starts_with("http://") || config.url.starts_with("https://")) {
        return Err("URL 需要以 http(s):// 开头".to_string());
    }
    if config.duration_ms.unwrap_or(0) == 0 && config.total_requests.unwrap_or(0) == 0 {
        return Err("请设置压测时长或请求数".to_string());
    }
    if config.duration_ms.unwrap_or(0) > 600_000 {
        return Err("压测时长最多 10 分钟".to_string());
    }
    Ok(())
}
