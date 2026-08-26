# Restricted analysis runner for od_python (JoyAgent PythonInterpreter analogue).
# Reads JSON {code, frames, handle} from stdin; prints JSON {ok, stdout, result, error}.
import json
import sys
import traceback

def _has_forbidden(code: str) -> bool:
    lowered = code.lower()
    return any(tok in lowered for tok in (
        "subprocess", "socket", "os.system", "os.popen", "ctypes",
        "multiprocessing", "__import__", "pathlib", "shutil.rmtree",
    ))

def main():
    payload = json.load(sys.stdin)
    code = str(payload.get("code") or "")
    frames = payload.get("frames") or {}
    handle = str(payload.get("handle") or "")
    rows = frames.get(handle) if handle in frames else None
    if rows is None and frames:
        rows = next(iter(frames.values()))

    stdout_chunks = []

    def _print(*args, **kwargs):
        sep = kwargs.get("sep", " ")
        end = kwargs.get("end", "\n")
        stdout_chunks.append(sep.join(str(a) for a in args) + end)

    g = {
        "__builtins__": {
            "abs": abs, "all": all, "any": any, "bool": bool, "dict": dict,
            "enumerate": enumerate, "filter": filter, "float": float, "int": int,
            "len": len, "list": list, "map": map, "max": max, "min": min,
            "pow": pow, "print": _print, "range": range, "round": round,
            "sorted": sorted, "str": str, "sum": sum, "tuple": tuple, "zip": zip,
        },
        "frames": frames,
        "rows": rows if isinstance(rows, list) else [],
        "handle": handle,
    }

    try:
        import pandas as pd
        g["pd"] = pd
        g["pandas"] = pd
        frame_dfs = {k: pd.DataFrame(v) for k, v in frames.items() if isinstance(v, list)}
        g["frame_dfs"] = frame_dfs
        if handle in frame_dfs:
            g["df"] = frame_dfs[handle]
        elif frame_dfs:
            g["df"] = next(iter(frame_dfs.values()))
        else:
            g["df"] = pd.DataFrame(g["rows"])
    except Exception:
        g["pd"] = None
        g["df"] = None
        g["frame_dfs"] = {}

    for mod_name, alias in (("numpy", "np"), ("scipy", "scipy"), ("sklearn", "sklearn"), ("statsmodels", "statsmodels")):
        try:
            g[alias] = __import__(mod_name)
            g[mod_name] = g[alias]
        except Exception:
            g[alias] = None

    try:
        import statistics
        g["statistics"] = statistics
        import math
        g["math"] = math
    except Exception:
        pass

    if _has_forbidden(code):
        json.dump({"ok": False, "error": "forbidden import"}, sys.stdout, ensure_ascii=False)
        return

    try:
        exec(compile(code, "<od_python>", "exec"), g, g)
        result = g.get("result", None)
        if result is not None and hasattr(result, "to_dict"):
            try:
                result = result.head(20).to_dict(orient="records")
            except Exception:
                result = str(result)[:4000]
        elif result is not None and not isinstance(result, (str, int, float, bool, list, dict, type(None))):
            result = str(result)[:4000]
        stdout = "".join(stdout_chunks)
        if len(stdout) > 16000:
            stdout = stdout[:16000] + "\n…(truncated)"
        json.dump({"ok": True, "stdout": stdout, "result": result}, sys.stdout, ensure_ascii=False, default=str)
    except Exception as e:
        json.dump({
            "ok": False,
            "error": f"{type(e).__name__}: {e}",
            "stdout": "".join(stdout_chunks)[:4000],
            "trace": traceback.format_exc()[-2000:],
        }, sys.stdout, ensure_ascii=False)

if __name__ == "__main__":
    main()
