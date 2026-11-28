// CPython inside this process, through bun:ffi: no HTTP server, no subprocess per call.
// Load it on one thread only (worker.ts does).
import { dlopen, FFIType, ptr } from "bun:ffi";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { arr, obj, str } from "@rustybuns/util/guard";
import bridge from "./bridge.py" with { type: "text" };

/** What the chosen interpreter says about itself. */
const Probe = obj({ base: str(4000), paths: arr(str(4000), 500), libs: arr(str(4000), 20), sites: arr(str(4000), 100) });

const PROBE = `
import json, os, sys, sysconfig
v = sysconfig.get_config_var
names = [n for n in (v("INSTSONAME"), v("LDLIBRARY")) if n]
dirs = [v("LIBDIR"), v("LIBDIR") and v("MULTIARCH") and os.path.join(v("LIBDIR"), v("MULTIARCH")), os.path.join(sys.base_prefix, "lib"), v("PYTHONFRAMEWORKPREFIX")]
libs = [os.path.join(d, n) for d in dirs if d for n in names]
if os.name == "nt":
    libs = [os.path.join(sys.base_prefix, "python%d%d.dll" % sys.version_info[:2])]
print(json.dumps({"base": sys.base_prefix, "paths": [p for p in sys.path if p], "libs": libs, "sites": [p for p in sys.path if p.endswith(("site-packages", "dist-packages"))]}))
`;

/** Ask `python` (PYTHON, so a venv's interpreter brings its packages) where its library and imports are. */
function probe(python: string) {
  const r = Bun.spawnSync([python, "-c", PROBE]);
  if (!r.success) throw new Error(`${python} didn't run: ${r.stderr.toString().trim()}`);
  return Probe(JSON.parse(r.stdout.toString()));
}

const cstr = (s: string) => ptr(Buffer.from(s + "\0"));

/** The libc calls the embedding needs before Python starts. */
function libc() {
  return dlopen(process.platform === "darwin" ? "libSystem.B.dylib" : "libc.so.6", {
    setenv: { args: [FFIType.ptr, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
    unsetenv: { args: [FFIType.ptr], returns: FFIType.i32 },
    dlopen: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.ptr },
  }).symbols;
}

/** Start the interpreter with `appDir` first on its import path; the answer calls into it. */
export function startPython(appDir: string, python = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3")) {
  const info = probe(python);
  const lib = process.env.LIBPYTHON ?? info.libs.find((p) => !p.endsWith(".a") && existsSync(p));
  if (!lib) throw new Error(`no shared libpython for ${python} (looked at ${info.libs.join(", ")}). Set LIBPYTHON.`);

  const c = process.platform === "win32" ? null : libc();
  // C extensions (numpy and friends) look libpython's symbols up globally: RTLD_NOW | RTLD_GLOBAL.
  if (process.platform === "linux") c?.dlopen(cstr(lib), 0x102);

  const { symbols: py } = dlopen(lib, {
    Py_InitializeEx: { args: [FFIType.i32], returns: FFIType.void },
    PyEval_SaveThread: { args: [], returns: FFIType.ptr },
    PyGILState_Ensure: { args: [], returns: FFIType.i32 },
    PyGILState_Release: { args: [FFIType.i32], returns: FFIType.void },
    PyRun_SimpleStringFlags: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    PyImport_AddModule: { args: [FFIType.ptr], returns: FFIType.ptr },
    PyObject_GetAttrString: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    PyUnicode_FromString: { args: [FFIType.ptr], returns: FFIType.ptr },
    PyUnicode_AsUTF8: { args: [FFIType.ptr], returns: FFIType.cstring },
    PyTuple_New: { args: [FFIType.i64], returns: FFIType.ptr },
    PyTuple_SetItem: { args: [FFIType.ptr, FFIType.i64, FFIType.ptr], returns: FFIType.i32 },
    PyObject_CallObject: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.ptr },
    Py_DecRef: { args: [FFIType.ptr], returns: FFIType.void },
    PyErr_Print: { args: [], returns: FFIType.void },
  });

  // An embedded interpreter can't find its standard library from the Bun executable's path.
  // Only for the start, so Python's own child processes don't inherit it.
  c?.setenv(cstr("PYTHONHOME"), cstr(info.base), 1);
  py.Py_InitializeEx(0);
  c?.unsetenv(cstr("PYTHONHOME"));

  const run = (code: string) => {
    if (py.PyRun_SimpleStringFlags(cstr(code), null) !== 0) throw new Error("Python failed while starting (see the log above)");
  };
  // A JSON list of strings is also a Python list literal.
  run(`import sys\nsys.path[:0] = ${JSON.stringify([resolve(appDir), ...info.paths])}`);
  // .pth files too, which is how a venv's editable installs are found.
  run(`import site\nfor d in ${JSON.stringify(info.sites)}: site.addsitedir(d)`);
  run(bridge);
  const fn = py.PyObject_GetAttrString(py.PyImport_AddModule(cstr("__main__")), cstr("_rb_call"));
  if (!fn) throw new Error("the bridge didn't load");
  py.PyEval_SaveThread(); // let go of the GIL, so Python's own threads run between calls

  /** One call: the request JSON goes in, the reply JSON comes out. */
  return (request: string): string => {
    const gil = py.PyGILState_Ensure();
    try {
      const args = py.PyTuple_New(1);
      py.PyTuple_SetItem(args, 0, py.PyUnicode_FromString(cstr(request))); // the tuple owns the string now
      const out = py.PyObject_CallObject(fn, args);
      py.Py_DecRef(args);
      if (!out) {
        py.PyErr_Print();
        throw new Error("the Python bridge itself failed");
      }
      const reply = String(py.PyUnicode_AsUTF8(out)); // copied before the object goes
      py.Py_DecRef(out);
      return reply;
    } finally {
      py.PyGILState_Release(gil);
    }
  };
}
