# Runs once inside the embedded interpreter. JSON text in, JSON text out, so the
# TypeScript side never touches a Python object.
import importlib
import json
import traceback


def _rb_call(request):
    try:
        call = json.loads(request)
        api = importlib.import_module("api")
        if call["fn"] not in api.__all__:
            raise PermissionError(f"{call['fn']} is not in api.__all__")
        value = getattr(api, call["fn"])(*call["args"])
        return json.dumps({"ok": True, "value": value}, allow_nan=False)
    except BaseException as e:  # SystemExit too: it must not take the host down
        return json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}", "traceback": traceback.format_exc()})
