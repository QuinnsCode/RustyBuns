// GitHub's device flow, faked: a code is handed out, then "pending" until the person types it, then a token
export function fakeGitHub() {
  let typed = new Set<string>();
  const users: Record<string, string> = {};
  let n = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/login/device/code") {
        n++;
        return Response.json({ device_code: `dev${n}`, user_code: `ABCD-000${n}`, verification_uri: "https://github.com/login/device", expires_in: 900, interval: 0 });
      }
      if (url.pathname === "/login/oauth/access_token") {
        const code = new URLSearchParams(await req.text()).get("device_code") ?? "";
        return Response.json(typed.has(code) ? { access_token: `tok_${code}` } : { error: "authorization_pending" });
      }
      if (url.pathname === "/user") {
        const login = users[(req.headers.get("authorization") ?? "").replace("Bearer ", "")];
        return login ? Response.json({ login }) : new Response("{}", { status: 401 });
      }
      return new Response("", { status: 404 });
    },
  });
  return {
    base: `http://localhost:${server.port}`,
    type(device: string, login: string) { users[`tok_${device}`] = login; typed.add(device); },
    expire(login: string) { for (const k of Object.keys(users)) if (users[k] === login) delete users[k]; },
    stop: () => server.stop(true),
  };
}

