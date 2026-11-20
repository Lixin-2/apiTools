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
    /// 0 表示不限速
    #[serde(default)]
    pub target_rps: u64,
    #[serde(default)]
    pub ramp_up_ms: u64,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

fn default_concurrency() -> usize {
    10
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
            } else if message.contains("connect") || message.contains("Connection") {
                "连接失败".to_string()
            } else {
                message.chars().take(60).collect::<String>()
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
pub async fn run(app: tauri::AppHandle, config: LoadTestConfig) {
    use tauri::Emitter;

    let concurrency = config.concurrency.clamp(1, MAX_CONCURRENCY);
    let stop = Arc::new(AtomicBool::new(false));
    let sent = Arc::new(AtomicU64::new(0));
    if let Ok(mut guard) = CURRENT.lock() {
        *guard = Some(stop.clone());
    }

    let metrics = Arc::new(Mutex::new(Metrics::new()));
    let started = Instant::now();
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
        let worker_config = config.clone();
        let worker_headers = headers.clone();
        let worker_body = body.clone();
        let worker_parts = parts.clone();
        let ramp = if config.ramp_up_ms > 0 {
            Duration::from_millis(config.ramp_up_ms * index as u64 / concurrency.max(1) as u64)
        } else {
            Duration::ZERO
        };
        let gap = if config.target_rps > 0 {
            Duration::from_millis((1000 * concurrency as u64 / config.target_rps).max(1))
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
                worker_sent.fetch_add(1, Ordering::Relaxed);

                let method = worker_config.method.clone();
                let url = worker_config.url.clone();
                let headers = worker_headers.clone();
                let body = worker_body.clone();
                let parts = worker_parts.clone();
                let timeout = worker_config.timeout_ms;

                let begin = Instant::now();
                let result = tokio::task::spawn_blocking(move || {
                    if parts.is_empty() {
                        http_client::execute(&method, &url, &headers, body.as_deref(), timeout)
                    } else {
                        http_client::execute_multipart(&method, &url, &headers, &parts, timeout)
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

                if !gap.is_zero() {
                    tokio::time::sleep(gap).await;
                }
            }
        }));
    }

    // 定时推送快照，直到所有 worker 结束
    let metrics_push = metrics.clone();
    let app_push = app.clone();
    let stop_push = stop.clone();
    let push_task = tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(PUSH_INTERVAL_MS)).await;
            let snapshot = metrics_push.lock().map(|guard| {
                guard.snapshot(!stop_push.load(Ordering::Relaxed), started.elapsed().as_millis() as u64, concurrency)
            });
            if let Ok(snapshot) = snapshot {
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
    let _ = push_task.await;

    // 最终快照
    if let Ok(guard) = metrics.lock() {
        let snapshot = guard.snapshot(false, started.elapsed().as_millis() as u64, concurrency);
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
