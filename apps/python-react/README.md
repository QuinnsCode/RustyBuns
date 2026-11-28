# python-react

> **What it proves:** a React page calls an existing Python codebase as typed functions, with no web framework in Python and no second server. CPython runs inside the app's Bun process through `bun:ffi`. One of the [Rusty Buns](../../README.md#see-it-work) examples; all of them are in [EXAMPLES.md](../../EXAMPLES.md).

## Use it

You need Bun and a Python 3 built with a shared library (Apple's, python.org's, Homebrew's and `uv`'s usually are).

```sh
cd apps/python-react
bun run dev                              # builds, then opens the app
PYTHON=.venv/bin/python bun run dev      # with your venv's packages
PYTHON_APP=~/code/myproject bun run dev  # with your code: it needs an api.py
```

Type some numbers and press Summarize: Python does the maths.

## Move your code over

1. Write an `api.py` beside your code. It imports what the page needs and lists it in `__all__`. Nothing else is reachable.
2. Return JSON-shaped values: dicts, lists, strings, numbers, booleans, `None`. Convert first (`array.tolist()`, `df.to_dict("records")`, `date.isoformat()`).
3. Describe each answer once in [`src/shapes.ts`](src/shapes.ts), and add a function for it in [`src/actions/python.ts`](src/actions/python.ts).
4. Import that function in React and `await` it.

```py
# api.py
from stats import summarize
__all__ = ["summarize"]
```

```ts
// src/actions/python.ts ("use server": runs on the Bun host)
export async function summarize(numbers: number[]): Promise<Summary> {
  return callPython("summarize", [Numbers(numbers)], Summary);
}
```

## How it works

| File | Job |
|---|---|
| [`src/python/libpython.ts`](src/python/libpython.ts) | Finds `libpython` by asking `PYTHON`, starts it with `bun:ffi`, passes JSON text in and out |
| [`src/python/bridge.py`](src/python/bridge.py) | Calls the named function; an exception becomes an error reply, with the traceback in the host's log |
| [`src/python/worker.ts`](src/python/worker.ts) | The one thread Python lives on, so a slow call doesn't stall the app |
| [`src/python/call.ts`](src/python/call.ts) | `callPython(name, args, guard)` |

## Know before you choose this

- **Local apps only.** Python runs in the app's process, so this fits a desktop app or a tool on your own machine. It can't run on a Cloudflare Worker. For a public website, keep Python as its own HTTP service (FastAPI and the like) and point React at it.
- **One call at a time.** There is one interpreter on one thread. A ten-second call makes the next one wait.
- **One process.** A crash in a C extension takes the app down with it.
- **Python is not in the binary.** `bun run desktop:build` makes one executable, but the machine still needs Python, your packages and the `python/` folder (beside the executable, or `PYTHON_APP`).
- **`bun:ffi` is marked experimental by Bun.**
- Tried by hand with a venv, numpy and the compiled binary on macOS arm64. CI runs the journey test on Linux. Windows is untried.

## Test

```sh
bun test test   # build, call Python through the page's actions, hit a Python error, call again
```
