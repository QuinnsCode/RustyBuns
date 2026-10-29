import { expect, setDefaultTimeout, test } from "bun:test";
import { buildOne, imageTag, startProdLike, type ContainerBinding } from "../../../packages/cli/src/containers.ts";
import { GITHUB_HOSTS, REGISTRIES, hostList } from "../src/egress.ts";

// Opt-in (#1732): builds the real deploy-sandbox/ci.Dockerfile and runs it behind the egress gate as CI_RUNNER
// has it in production. Needs Docker and the network, so: CI_IMAGE_TEST=1 bun test test/ci-image.test.ts
setDefaultTimeout(600_000);

test.skipIf(!process.env.CI_IMAGE_TEST)("the check image clones from GitHub, installs from npm, and is turned away anywhere else", async () => {
  const b: ContainerBinding = { name: "CI_RUNNER", className: "CiRunner", dockerfile: "deploy-sandbox/ci.Dockerfile", context: "deploy-sandbox", maxInstances: 1, instanceType: "basic",
    egress: { module: "src/egress.ts", hosts: hostList(REGISTRIES, GITHUB_HOSTS) } };
  await buildOne("codesplitter", b, { log: () => {} });
  const gate = await startProdLike("codesplitter", b, imageTag("codesplitter", b), { env: {} });
  const name = `rb-codesplitter-${b.name}-${process.pid}`.toLowerCase();
  const sh = (cmd: string) => Bun.spawnSync(["docker", "exec", name, "sh", "-c", cmd], { stdout: "pipe", stderr: "pipe" });
  const out = (r: ReturnType<typeof sh>) => r.stdout.toString() + r.stderr.toString();
  try {
    await Bun.sleep(3000);
    expect(out(sh("git ls-remote https://github.com/QuinnsCode/RustyBuns HEAD")).trim()).toMatch(/^[0-9a-f]{40}\s+HEAD$/);
    const install = sh("mkdir -p /tmp/p && cd /tmp/p && echo '{\"dependencies\":{\"is-odd\":\"3.0.1\"}}' > package.json && bun install");
    expect(install.exitCode).toBe(0);
    const off = sh("git ls-remote https://gitlab.com/gitlab-org/gitlab-foss HEAD");
    expect(off.exitCode).not.toBe(0);
    expect(out(off)).toContain("403");
  } finally { gate.stop(); }
});
