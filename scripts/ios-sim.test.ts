import { expect, test } from "bun:test";
import { appUrl, deepLink, devicesOf, parseArgs, pickDevice } from "./ios-sim-lib.ts";

test("a manual run's address and state become the link the shell opens", () => {
  const a = parseArgs(["my-app.workers.dev", "level=5", "beat=40", "--device", "iPhone 15"]);
  expect(a).toEqual({ url: "my-app.workers.dev", state: ["level=5", "beat=40"], device: "iPhone 15", build: false });
  const link = deepLink(appUrl(a.url, a.state));
  expect(new URL(link).searchParams.get("url")).toBe("https://my-app.workers.dev/?level=5&beat=40");
});

test("state replaces what the address already asks for, and bad input is refused", () => {
  expect(appUrl("https://x.dev/?level=1&a=b", ["level=3"]).search).toBe("?level=3&a=b");
  expect(() => appUrl("ftp://x.dev")).toThrow();
  expect(() => appUrl("x.dev", ["oops"])).toThrow();
  expect(() => parseArgs([])).toThrow();
  expect(() => parseArgs(["x.dev", "--nope"])).toThrow();
});

test("the simulator is the named one, else the booted one, else the first iPhone", () => {
  const list = devicesOf({ devices: {
    "com.apple.CoreSimulator.SimRuntime.iOS-17-0": [
      { udid: "1", name: "iPad Air", state: "Shutdown", isAvailable: true },
      { udid: "2", name: "iPhone 15", state: "Shutdown", isAvailable: true },
      { udid: "3", name: "iPhone SE", state: "Booted", isAvailable: true },
    ],
    "com.apple.CoreSimulator.SimRuntime.watchOS-10-0": [{ udid: "4", name: "Watch", state: "Booted", isAvailable: true }],
  } });
  expect(list.length).toBe(3);
  expect(pickDevice(list)?.udid).toBe("3");
  expect(pickDevice(list, "iPhone 15")?.udid).toBe("2");
  expect(pickDevice(list, "nope")).toBeNull();
  expect(pickDevice(list.map((d) => ({ ...d, state: "Shutdown" })))?.udid).toBe("2");
  expect(devicesOf("junk")).toEqual([]);
});
