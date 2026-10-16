"""Read-only public API burst. Never creates accounts, entries or payments."""
import argparse
import concurrent.futures
import json
import re
import threading
import time
import urllib.request
import urllib.error
from collections import Counter

parser = argparse.ArgumentParser()
parser.add_argument("--url", required=True)
parser.add_argument("--users", type=int, default=150)
args = parser.parse_args()
if not 1 <= args.users <= 150:
    raise SystemExit("Maximum supported burst is 150 readers.")
if not args.url.startswith(("https://fiszy.pl/api/auctions", "http://127.0.0.1:")):
    raise SystemExit("Only the Fiszy public auction API or local test server is allowed.")

barrier = threading.Barrier(args.users)
def read(_):
    barrier.wait(timeout=30)
    started = time.perf_counter()
    try:
        req = urllib.request.Request(args.url, headers={"User-Agent": "Fiszy-Performance-Audit/1.0"})
        with urllib.request.urlopen(req, timeout=30) as response:
            data = json.load(response)
            valid = isinstance(data, dict) and data.get("outcome") == "ok"
            timing = re.search(r"auction;dur=([\d.]+)", response.headers.get("Server-Timing", ""))
            return {"ms": (time.perf_counter() - started) * 1000, "status": response.status,
                    "valid": valid, "cache": response.headers.get("x-vercel-cache", "unknown"), "origin_ms": float(timing[1]) if timing else None}
    except Exception as error:
        return {"ms": (time.perf_counter() - started) * 1000, "status": getattr(error, "code", "error"), "valid": False, "cache": "unknown", "error": type(error).__name__}

started = time.perf_counter()
with concurrent.futures.ThreadPoolExecutor(max_workers=args.users) as pool:
    results = list(pool.map(read, range(args.users)))
times = sorted(row["ms"] for row in results)
def percentile(p):
    return round(times[min(len(times)-1, int((len(times)-1)*p))], 1)
print(json.dumps({"url": args.url, "concurrent_readers": args.users,
    "successful": sum(row["valid"] for row in results), "errors": sum(not row["valid"] for row in results),
    "statuses": dict(Counter(str(row["status"]) for row in results)),
    "cache": dict(Counter(row["cache"] for row in results)),
    "duration_s": round(time.perf_counter()-started, 2),
    "p50_ms": percentile(.5), "p95_ms": percentile(.95), "p99_ms": percentile(.99),
    "origin_p95_ms": sorted(row["origin_ms"] for row in results if row.get("origin_ms") is not None)[int((sum(row.get("origin_ms") is not None for row in results)-1)*.95)] if any(row.get("origin_ms") is not None for row in results) else None,
    "note": "Client wall time includes the execution environment egress proxy; this is not browser latency or a signed-in payment test."}, indent=2))
