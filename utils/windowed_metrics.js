const DEFAULT_WINDOW_MS = 10_000;

/**
 * Collect privacy-safe count and duration summaries for a fixed set of
 * runtime events. Callers should use static metric names and status labels;
 * request parameters and identity data must never be passed here.
 */
export const create_windowed_metrics = ({
  window_ms = DEFAULT_WINDOW_MS,
  write = (line) => console.log(line),
} = {}) => {
  const windows = new Map();
  let timer = null;

  const flush = () => {
    const ended_at = new Date().toISOString();
    windows.forEach((metric, name) => {
      write(JSON.stringify({
        event: "fracto_metric_window",
        metric: name,
        started_at: metric.started_at,
        ended_at,
        count: metric.count,
        duration_ms_total: Math.round(metric.duration_ms_total),
        duration_ms_average: Math.round(metric.duration_ms_total / metric.count),
        duration_ms_max: Math.round(metric.duration_ms_max),
        outcomes: metric.outcomes,
      }));
    });
    windows.clear();
  };

  const record = (name, duration_ms, outcome) => {
    if (typeof name !== "string" || !/^[a-z_]+$/.test(name)) return;
    const safe_duration = Number(duration_ms);
    if (!Number.isFinite(safe_duration) || safe_duration < 0) return;
    const safe_outcome = typeof outcome === "number" && Number.isInteger(outcome)
      ? String(outcome)
      : typeof outcome === "string" && /^[a-z_]+$/.test(outcome)
        ? outcome
        : "other";
    const metric = windows.get(name) || {
      started_at: new Date().toISOString(),
      count: 0,
      duration_ms_total: 0,
      duration_ms_max: 0,
      outcomes: {},
    };
    metric.count += 1;
    metric.duration_ms_total += safe_duration;
    metric.duration_ms_max = Math.max(metric.duration_ms_max, safe_duration);
    metric.outcomes[safe_outcome] = (metric.outcomes[safe_outcome] || 0) + 1;
    windows.set(name, metric);

    if (!timer) {
      timer = setInterval(flush, window_ms);
      timer.unref?.();
    }
  };

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    flush();
  };

  return { record, flush, stop };
};

const runtime_metrics = create_windowed_metrics();

/** Record one low-cardinality runtime sample for periodic log aggregation. */
export const record_runtime_metric = (...args) =>
  runtime_metrics.record(...args);
