// 🥐 node-pty, Rusty Buns-ified.
// Agent Office only uses spawn / onData / onExit / write / resize / kill / pid,
// so this swaps the native .node addon for Bun's built-in PTY (Bun.spawn({ terminal })).
// No node-gyp, no prebuilds, and it survives `bun build --compile`.

function listeners() {
  const set = new Set();
  const on = (cb) => {
    set.add(cb);
    return { dispose: () => set.delete(cb) };
  };
  const fire = (v) => { for (const cb of set) cb(v); };
  return { on, fire };
}

export function spawn(file, args = [], opts = {}) {
  if (typeof Bun === "undefined") throw new Error("this node-pty shim needs Bun (Bun.spawn terminal)");
  const argv = typeof args === "string" ? [file, args] : [file, ...args];
  const data = listeners();
  const exit = listeners();
  const decoder = new TextDecoder();
  const env = { ...(opts.env ?? process.env) };
  if (opts.name) env.TERM = opts.name;

  const proc = Bun.spawn(argv, {
    cwd: opts.cwd,
    env,
    terminal: {
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      data(_term, chunk) {
        const s = decoder.decode(chunk, { stream: true });
        if (s) data.fire(s);
      },
    },
  });

  let exited = false;
  proc.exited.then((code) => {
    // let the last bytes drain to onData before onExit, like node-pty
    setTimeout(() => {
      exited = true;
      const tail = decoder.decode();
      if (tail) data.fire(tail);
      exit.fire({ exitCode: code ?? 0, signal: proc.signalCode ? signalNumber(proc.signalCode) : undefined });
      try { proc.terminal?.close(); } catch {}
    }, 20);
  });

  return {
    pid: proc.pid,
    get cols() { return opts.cols; },
    get rows() { return opts.rows; },
    process: file,
    onData: data.on,
    onExit: exit.on,
    write(s) { if (!exited) proc.terminal.write(s); },
    resize(cols, rows) {
      if (exited) return;
      opts.cols = cols; opts.rows = rows;
      proc.terminal.resize(cols, rows);
    },
    kill(sig = "SIGHUP") { if (!exited) proc.kill(sig); },
    pause() {}, resume() {}, clear() {},
  };
}

function signalNumber(name) {
  return { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 }[name];
}

export default { spawn };
