import React from 'react';
import { FormField, LoadTestSnapshot } from '../../shared/types';
import { Modal } from './Dialogs';
import { BarChart, CHART_COLORS, DonutChart, LineChart } from './Charts';
import { formatBytes, Icon } from './ui';

interface Props {
  requestName: string;
  payload: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
    formFields?: FormField[];
  };
  onClose: () => void;
}

function Metric({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: 'ok' | 'danger' | 'warn' | 'accent';
}) {
  return (
    <div className={`lt-metric ${tone ?? ''}`}>
      <div className="lt-metric-label">{label}</div>
      <div className={`lt-metric-value ${tone ?? ''}`}>
        {value}
        {unit && <span className="lt-metric-unit">{unit}</span>}
      </div>
    </div>
  );
}

export default function LoadTestDialog({ requestName, payload, onClose }: Props) {
  const [concurrency, setConcurrency] = React.useState('10');
  const [mode, setMode] = React.useState<'duration' | 'count'>('duration');
  const [duration, setDuration] = React.useState('30');
  const [total, setTotal] = React.useState('1000');
  const [rateMode, setRateMode] = React.useState<'unlimited' | 'fixed' | 'random'>('unlimited');
  const [rps, setRps] = React.useState('50');
  const [minRps, setMinRps] = React.useState('20');
  const [maxRps, setMaxRps] = React.useState('80');
  const [changeSecs, setChangeSecs] = React.useState('5');
  const [rampUp, setRampUp] = React.useState('0');
  const [running, setRunning] = React.useState(false);
  const [snapshot, setSnapshot] = React.useState<LoadTestSnapshot | null>(null);
  const [series, setSeries] = React.useState<{ qps: number[]; avg: number[]; p95: number[] }>({
    qps: [],
    avg: [],
    p95: [],
  });
  const [error, setError] = React.useState('');
  const [poolPath, setPoolPath] = React.useState('');
  const [poolName, setPoolName] = React.useState('');
  const [poolInfo, setPoolInfo] = React.useState<{ count: number; bytes: number } | null>(null);
  const [poolError, setPoolError] = React.useState('');
  const [csvPath, setCsvPath] = React.useState('');
  const [csvName, setCsvName] = React.useState('');
  const [csvInfo, setCsvInfo] = React.useState<{ columns: string[]; rows: number } | null>(null);
  const [csvError, setCsvError] = React.useState('');

  React.useEffect(() => {
    let disposeProgress: (() => void) | null = null;
    let disposeFinished: (() => void) | null = null;

    window.api
      .onLoadTestProgress((next) => {
        setSnapshot(next);
        setSeries((prev) => {
          const append = (list: number[], value: number) => {
            const next = [...list, value];
            return next.length > 900 ? next.slice(next.length - 900) : next;
          };
          return {
            qps: append(prev.qps, Number(next.qps.toFixed(2))),
            avg: append(prev.avg, Math.round(next.avgMs)),
            p95: append(prev.p95, next.p95),
          };
        });
        if (!next.running) setRunning(false);
      })
      .then((dispose) => {
        disposeProgress = dispose;
      });

    window.api
      .onLoadTestFinished((next) => {
        setSnapshot(next);
        setRunning(false);
      })
      .then((dispose) => {
        disposeFinished = dispose;
      });

    return () => {
      disposeProgress?.();
      disposeFinished?.();
    };
  }, []);

  const pickPool = async () => {
    setPoolError('');
    const file = await window.api.pickFile({ title: '选择报文 zip', extensions: ['zip'] });
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setPoolError('请选择 .zip 文件');
      return;
    }
    try {
      const info = await window.api.inspectBodyPool(file.path);
      setPoolPath(file.path);
      setPoolName(file.name);
      setPoolInfo(info);
    } catch (err: any) {
      setPoolError(err?.message ?? String(err));
    }
  };

  const clearPool = () => {
    setPoolPath('');
    setPoolName('');
    setPoolInfo(null);
    setPoolError('');
  };

  const pickCsv = async () => {
    setCsvError('');
    const file = await window.api.pickFile({ title: '选择变量 CSV', extensions: ['csv', 'txt'] });
    if (!file) return;
    try {
      const info = await window.api.inspectVarsCsv(file.path);
      setCsvPath(file.path);
      setCsvName(file.name);
      setCsvInfo(info);
    } catch (err: any) {
      setCsvError(err?.message ?? String(err));
    }
  };

  const clearCsv = () => {
    setCsvPath('');
    setCsvName('');
    setCsvInfo(null);
    setCsvError('');
  };

  const start = async () => {
    setError('');
    const num = (value: string) => Number(value) || 0;
    if (num(concurrency) < 1) {
      setError('并发数至少为 1');
      return;
    }
    if (mode === 'duration' && num(duration) < 1) {
      setError('压测时长至少 1 秒');
      return;
    }
    if (mode === 'count' && num(total) < 1) {
      setError('请求数至少为 1');
      return;
    }
    if (rateMode === 'fixed' && num(rps) < 1) {
      setError('固定 TPS 至少为 1（不限制请切到「不限速」）');
      return;
    }
    if (rateMode === 'random' && (num(minRps) < 1 || num(maxRps) < num(minRps))) {
      setError('随机区间需要：最小 TPS ≥ 1，且最大 ≥ 最小');
      return;
    }
    setSeries({ qps: [], avg: [], p95: [] });
    setSnapshot(null);
    try {
      await window.api.startLoadTest({
        method: payload.method,
        url: payload.url,
        headers: payload.headers,
        body: payload.body,
        formFields: payload.formFields,
        concurrency: num(concurrency),
        durationMs: mode === 'duration' ? num(duration) * 1000 : undefined,
        totalRequests: mode === 'count' ? num(total) : undefined,
        rateMode,
        targetRps: rateMode === 'fixed' ? num(rps) : 0,
        minRps: rateMode === 'random' ? num(minRps) : 0,
        maxRps: rateMode === 'random' ? num(maxRps) : 0,
        rpsChangeSecs: rateMode === 'random' ? Math.max(1, num(changeSecs)) : 0,
        rampUpMs: num(rampUp) * 1000,
        bodyPoolZip: poolPath || undefined,
        variablesCsv: csvPath || undefined,
      });
      setRunning(true);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    }
  };

  const stop = async () => {
    await window.api.stopLoadTest();
    setRunning(false);
  };

  const exportCsv = async () => {
    if (!snapshot) return;
    const rows = ['index,elapsed_ms,qps,avg_ms,p95_ms,total,success,failed'];
    const length = series.qps.length;
    for (let index = 0; index < length; index += 1) {
      rows.push(
        `${index},${(index + 1) * 200},${series.qps[index]},${series.avg[index]},${series.p95[index]},, ,`,
      );
    }
    rows.push('');
    rows.push('summary');
    rows.push(`total,${snapshot.total}`);
    rows.push(`success,${snapshot.success}`);
    rows.push(`failed,${snapshot.failed}`);
    rows.push(`avg_ms,${snapshot.avgMs.toFixed(1)}`);
    rows.push(`p50_ms,${snapshot.p50}`);
    rows.push(`p90_ms,${snapshot.p90}`);
    rows.push(`p95_ms,${snapshot.p95}`);
    rows.push(`p99_ms,${snapshot.p99}`);
    rows.push(`max_ms,${snapshot.maxMs}`);
    rows.push(`qps,${snapshot.qps.toFixed(2)}`);
    rows.push(`throughput,${formatBytes(Math.round(snapshot.bytesPerSec))}/s`);
    await window.api.saveResponseFile({
      content: rows.join('\n'),
      fileName: `loadtest-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`,
    });
  };

  const close = async () => {
    if (running) await window.api.stopLoadTest();
    onClose();
  };

  const statusItems = React.useMemo(() => {
    if (!snapshot) return [];
    const classes = snapshot.statusClasses;
    return [
      { label: '2xx', value: classes['2xx'] ?? 0, color: CHART_COLORS.green },
      { label: '3xx', value: classes['3xx'] ?? 0, color: CHART_COLORS.teal },
      { label: '4xx', value: classes['4xx'] ?? 0, color: CHART_COLORS.orange },
      { label: '5xx', value: classes['5xx'] ?? 0, color: CHART_COLORS.red },
      { label: '异常', value: classes['error'] ?? 0, color: CHART_COLORS.gray },
    ].filter((item) => item.value > 0);
  }, [snapshot]);

  const errorEntries = Object.entries(snapshot?.errors ?? {});

  return (
    <Modal
      title="压力测试"
      subtitle={`${requestName} · ${payload.method} ${payload.url}`}
      onClose={close}
      width={1000}
      footer={
        <>
          <span className="help">
            {running
              ? `运行中 · 已发 ${snapshot?.total ?? 0} 个请求`
              : snapshot
                ? `已结束 · 共 ${snapshot.total} 个请求`
                : '设置参数后开始压测'}
          </span>
          <span className="spacer" />
          {running ? (
            <button className="chip-button" onClick={stop}>
              <Icon name="stop" size={12} />
              停止
            </button>
          ) : (
            <button className="chip-button primary" onClick={start}>
              <Icon name="send" size={12} />
              开始压测
            </button>
          )}
          <button className="chip-button" onClick={exportCsv} disabled={!snapshot}>
            <Icon name="download" size={12} />
            导出 CSV
          </button>
          <button className="chip-button" onClick={close}>
            关闭
          </button>
        </>
      }
    >
      <div className="lt-shell">
        <div className="lt-section">
        <div className="lt-section-head">
          <span className="lt-section-title">压测参数</span>
          <span className="lt-target" title={`${payload.method} ${payload.url}`}>
            {payload.method} {payload.url}
          </span>
        </div>
        <div className="lt-config">
        <label className="lt-field">
          <span>并发数</span>
          <input
            className="text-input"
            value={concurrency}
            disabled={running}
            onChange={(event) => setConcurrency(event.target.value.replace(/[^0-9]/g, ''))}
          />
        </label>
        <div className="lt-field">
          <span>模式</span>
          <div className="seg">
            <button
              className={mode === 'duration' ? 'active' : ''}
              disabled={running}
              onClick={() => setMode('duration')}
            >
              定时长
            </button>
            <button
              className={mode === 'count' ? 'active' : ''}
              disabled={running}
              onClick={() => setMode('count')}
            >
              定请求数
            </button>
          </div>
        </div>
        {mode === 'duration' ? (
          <label className="lt-field">
            <span>时长（秒）</span>
            <input
              className="text-input"
              value={duration}
              disabled={running}
              onChange={(event) => setDuration(event.target.value.replace(/[^0-9]/g, ''))}
            />
          </label>
        ) : (
          <label className="lt-field">
            <span>请求数</span>
            <input
              className="text-input"
              value={total}
              disabled={running}
              onChange={(event) => setTotal(event.target.value.replace(/[^0-9]/g, ''))}
            />
          </label>
        )}
        <div className="lt-field" style={{ gridColumn: 'span 2' }}>
          <span>速率模式</span>
          <div className="seg">
            <button
              className={rateMode === 'unlimited' ? 'active' : ''}
              disabled={running}
              onClick={() => setRateMode('unlimited')}
            >
              不限速
            </button>
            <button
              className={rateMode === 'fixed' ? 'active' : ''}
              disabled={running}
              onClick={() => setRateMode('fixed')}
            >
              固定 TPS
            </button>
            <button
              className={rateMode === 'random' ? 'active' : ''}
              disabled={running}
              onClick={() => setRateMode('random')}
            >
              随机 TPS
            </button>
          </div>
        </div>
        {rateMode === 'fixed' && (
          <label className="lt-field">
            <span>目标 TPS</span>
            <input
              className="text-input"
              value={rps}
              disabled={running}
              onChange={(event) => setRps(event.target.value.replace(/[^0-9]/g, ''))}
            />
          </label>
        )}
        {rateMode === 'random' && (
          <>
            <label className="lt-field">
              <span>最小 TPS</span>
              <input
                className="text-input"
                value={minRps}
                disabled={running}
                onChange={(event) => setMinRps(event.target.value.replace(/[^0-9]/g, ''))}
              />
            </label>
            <label className="lt-field">
              <span>最大 TPS</span>
              <input
                className="text-input"
                value={maxRps}
                disabled={running}
                onChange={(event) => setMaxRps(event.target.value.replace(/[^0-9]/g, ''))}
              />
            </label>
            <label className="lt-field">
              <span>变化间隔（秒）</span>
              <input
                className="text-input"
                value={changeSecs}
                disabled={running}
                onChange={(event) => setChangeSecs(event.target.value.replace(/[^0-9]/g, ''))}
              />
            </label>
          </>
        )}
        <label className="lt-field">
          <span>逐级加压（秒）</span>
          <input
            className="text-input"
            value={rampUp}
            disabled={running}
            onChange={(event) => setRampUp(event.target.value.replace(/[^0-9]/g, ''))}
          />
        </label>
        </div>
      </div>

      <div className="lt-section">
        <div className="lt-section-head">
          <span className="lt-section-title">报文数据（可选）</span>
          {poolInfo && (
            <span className="help">
              {poolInfo.count} 份 · {formatBytes(poolInfo.bytes)}
            </span>
          )}
        </div>
        <div className="lt-pool">
          <button className="chip-button" onClick={pickPool} disabled={running}>
            <Icon name="file" size={12} />
            {poolPath ? '更换 zip' : '选择 zip 报文'}
          </button>
          {poolPath ? (
            <div className="lt-pool-file">
              <span className="lt-pool-name" title={poolPath}>
                {poolName}
              </span>
              <button className="icon-btn" title="移除报文池" onClick={clearPool} disabled={running}>
                <Icon name="close" size={11} />
              </button>
            </div>
          ) : (
            <span className="help">
              按文件名顺序轮询，每份文件作为一次请求体；不选则使用请求体面板里的内容
            </span>
          )}
        </div>
        {poolError && (
          <div className="body-error">
            <Icon name="info" size={12} />
            <span>{poolError}</span>
          </div>
        )}
      </div>

      <div className="lt-section">
        <div className="lt-section-head">
          <span className="lt-section-title">变量数据（可选）</span>
          {csvInfo && (
            <span className="help">
              {csvInfo.rows} 行 · {csvInfo.columns.filter(Boolean).join(', ')}
            </span>
          )}
        </div>
        <div className="lt-pool">
          <button className="chip-button" onClick={pickCsv} disabled={running}>
            <Icon name="file" size={12} />
            {csvPath ? '更换 CSV' : '选择变量 CSV'}
          </button>
          {csvPath ? (
            <div className="lt-pool-file">
              <span className="lt-pool-name" title={csvPath}>
                {csvName}
              </span>
              <button
                className="icon-btn"
                title="移除变量文件"
                onClick={clearCsv}
                disabled={running}
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          ) : (
            <span className="help">
              第一行是表头（变量名），其后每行一组值，按行轮询；用 {'${变量名}'} 引用
            </span>
          )}
        </div>
        {csvError && (
          <div className="body-error">
            <Icon name="info" size={12} />
            <span>{csvError}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="result-box" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {!snapshot ? (
        <div className="lt-empty">
          <Icon name="robot" size={22} />
          <div>配置并发与时长后点「开始压测」，结果会实时显示在这里</div>
        </div>
      ) : (
        <>
          <div className="lt-metrics">
            <Metric
              label={snapshot.targetRps > 0 ? `QPS / 目标 ${snapshot.targetRps}` : 'QPS'}
              value={snapshot.qps.toFixed(1)}
              tone="accent"
            />
            <Metric label="总请求" value={snapshot.total} />
            <Metric label="成功" value={snapshot.success} tone="ok" />
            <Metric
              label="失败"
              value={snapshot.failed}
              tone={snapshot.failed ? 'danger' : undefined}
            />
            <Metric label="平均延迟" value={Math.round(snapshot.avgMs)} unit="ms" />
            <Metric label="P95" value={snapshot.p95} unit="ms" />
          </div>

          <div className="lt-chart-card">
            <div className="lt-chart-title">
              吞吐与延迟
              <span className="help">每 200ms 采样 · 已运行 {(snapshot.elapsedMs / 1000).toFixed(0)}s</span>
            </div>
            <LineChart
              height={168}
              series={[
                { label: 'QPS', color: CHART_COLORS.accent, values: series.qps, axis: 'left' },
                { label: '平均延迟', color: CHART_COLORS.teal, values: series.avg, axis: 'right' },
                { label: 'P95', color: CHART_COLORS.orange, values: series.p95, axis: 'right' },
              ]}
            />
          </div>

          <div className="lt-charts">
            <div className="lt-chart-card">
              <div className="lt-chart-title">延迟分布</div>
              <BarChart buckets={snapshot.buckets} height={132} />
            </div>
            <div className="lt-chart-card">
              <div className="lt-chart-title">状态码分布</div>
              <DonutChart items={statusItems} height={132} />
            </div>
          </div>

          <div className="lt-detail">
            <div className="lt-card">
              <div className="lt-card-title">延迟分位</div>
              <div className="lt-kv">
                <span>P50</span>
                <b>{snapshot.p50} ms</b>
                <span>P90</span>
                <b>{snapshot.p90} ms</b>
                <span>P99</span>
                <b>{snapshot.p99} ms</b>
                <span>吞吐</span>
                <b>{formatBytes(Math.round(snapshot.bytesPerSec))}/s</b>
                <span>并发</span>
                <b>{snapshot.concurrency}</b>
              </div>
            </div>
            <div className="lt-card">
              <div className="lt-card-title">错误分布</div>
              {errorEntries.length ? (
                <div className="lt-kv">
                  {errorEntries.map(([key, value]) => (
                    <React.Fragment key={key}>
                      <span className="lt-ellipsis" title={key}>
                        {key}
                      </span>
                      <b className="danger">{value}</b>
                    </React.Fragment>
                  ))}
                </div>
              ) : (
                <p className="help">没有错误</p>
              )}
            </div>
            <div className="lt-card">
              <div className="lt-card-title">最慢请求</div>
              {snapshot.slowest.length ? (
                <div className="lt-kv">
                  {snapshot.slowest.slice(0, 5).map((item, index) => (
                    <React.Fragment key={`${item.ms}-${index}`}>
                      <span>#{index + 1}</span>
                      <b>
                        {item.ms} ms · {item.status || item.error || '-'}
                      </b>
                    </React.Fragment>
                  ))}
                </div>
              ) : (
                <p className="help">暂无数据</p>
              )}
            </div>
          </div>
        </>
      )}
      </div>
    </Modal>
  );
}
