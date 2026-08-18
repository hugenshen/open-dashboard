"""Tool governance pipeline — pre(guard) → execute(timeout) → retry(backoff) → post(normalize).

参考 DeepSeek Harness 的 tool-execution-pipeline 思路，把治理横切到工具执行之外：
- pre：参数必填校验、只读 SQL guard 复用（sqlbot.guard）
- execute：线程软超时兜底（内部 bi_call 网络超时优先）
- retry：仅对可重试错误（超时 / 网络 / 5xx）做指数退避重试；业务错误不重试
- post：把抛错归一化为 {"ok": False, "error": ...}，保证工具环拿到结构化结果

所有策略都是"注册即生效、可卸载"的字典，不侵入工具实现。
"""

from __future__ import annotations

import time
import traceback
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutTimeout
from typing import Any, Callable, Dict, Optional

# per-tool 治理策略：timeout_s（软超时兜底）/ retries / retry_delay_s / retry_backoff（倍数）
DEFAULT_POLICY: Dict[str, Dict[str, Any]] = {
    # 查询类工具：网络重，超时兜底 60s，最多重试 2 次（指数退避 1.5s → 3s）
    "od_run_query": {"timeout_s": 60, "retries": 2, "retry_delay_s": 1.5, "retry_backoff": 2.0},
    "od_run_sql": {"timeout_s": 60, "retries": 2, "retry_delay_s": 1.5, "retry_backoff": 2.0},
    "od_profile_dataset": {"timeout_s": 60, "retries": 1, "retry_delay_s": 1.0, "retry_backoff": 2.0},
    "od_plan_charts": {"timeout_s": 60, "retries": 1, "retry_delay_s": 1.0, "retry_backoff": 2.0},
    "od_layout_board": {"timeout_s": 60, "retries": 1, "retry_delay_s": 1.0, "retry_backoff": 2.0},
    # 其他工具默认：软超时 90s，不重试（写类/编排类工具重复执行有副作用风险）
    "__default__": {"timeout_s": 90, "retries": 0, "retry_delay_s": 0.0, "retry_backoff": 2.0},
}

# 只对这类错误重试：网络层 / 后端 5xx / 超时。业务校验错误（4xx、只读拒绝、数据为空）不重试。
RETRYABLE_MARKERS = (
    "timeout",
    "timed out",
    "connection",
    "refused",
    "reset",
    "unreachable",
    " 5",
    " 502",
    " 503",
    " 504",
)

_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="tool-guard")


def _is_retryable(err: Exception) -> bool:
    msg = str(err).lower()
    return any(m in msg for m in RETRYABLE_MARKERS)


def policy_for(name: str, overrides: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, Any]:
    merged = dict(DEFAULT_POLICY)
    if overrides:
        for k, v in overrides.items():
            merged[k] = {**merged.get(k, {}), **v}
    return dict(merged.get(name, merged["__default__"]))


def pre_guard(name: str, args: Dict[str, Any]) -> Optional[str]:
    """参数必填校验（对查询类工具）。返回错误信息字符串；None 表示通过。"""
    if name == "od_run_sql":
        if not str(args.get("sql") or "").strip():
            return "od_run_sql 缺少必填参数 sql"
        if not args.get("datasetId"):
            return "od_run_sql 缺少必填参数 datasetId"
    elif name == "od_run_query":
        if not args.get("datasetId"):
            return "od_run_query 缺少必填参数 datasetId"
    return None


def execute_guarded(
    tool: Any,
    args: Dict[str, Any],
    *,
    policy: Optional[Dict[str, Any]] = None,
    overrides: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Any:
    """治理管线执行工具。返回结构化结果（永不抛错给调用方）。"""
    name = getattr(tool, "name", "?")
    cfg = policy or policy_for(name, overrides)
    timeout_s = float(cfg.get("timeout_s") or 90)
    retries = int(cfg.get("retries") or 0)
    retry_delay = float(cfg.get("retry_delay_s") or 0.0)
    backoff = float(cfg.get("retry_backoff") or 2.0)

    # pre：guard
    guard_err = pre_guard(name, dict(args or {}))
    if guard_err:
        return {"ok": False, "error": f"guard: {guard_err}", "guarded": True}

    delay = retry_delay
    last_err: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            fut = _executor.submit(tool.execute, dict(args or {}))
            result = fut.result(timeout=timeout_s)
            # post：归一化（工具自己返回 dict 时直接透传；None 归一为 ok）
            if result is None:
                result = {"ok": True}
            return result
        except FutTimeout:
            last_err = TimeoutError(f"tool {name} timed out after {timeout_s}s (attempt {attempt + 1})")
        except Exception as e:  # noqa: BLE001 — 治理层统一兜底
            last_err = e
        if attempt < retries and _is_retryable(last_err):
            time.sleep(delay)
            delay *= backoff
            continue
        break

    # post：异常归一化为结构化错误，工具环可读
    return {"ok": False, "error": f"{name} 执行失败: {last_err}", "retried": attempt > 0}
