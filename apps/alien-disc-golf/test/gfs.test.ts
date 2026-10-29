import { describe, expect, test } from "bun:test";
import { gfsCandidates, isGrib } from "../src/edge/gfs.ts";
import { windResponse } from "../src/edge/worker.ts";

describe("which GFS file", () => {
  test.each([
    // now (UTC)              latest cycle            hours ahead
    ["2026-10-28T05:30:00Z", "2026-10-28T00:00:00Z", 6],
    ["2026-10-28T10:10:00Z", "2026-10-28T06:00:00Z", 3],
    ["2026-10-28T03:59:00Z", "2026-10-27T18:00:00Z", 9],
    ["2026-10-28T04:00:00Z", "2026-10-28T00:00:00Z", 3],
  ])("at %s asks for the %s run, f%i, then the run before", (now, cycle, hour) => {
    const [first, second] = gfsCandidates(new Date(now));
    expect(first!.cycle.toISOString()).toBe(new Date(cycle).toISOString());
    expect(first!.hour).toBe(hour);
    expect(first!.url).toContain(`gfs.t${String(first!.cycle.getUTCHours()).padStart(2, "0")}z.pgrb2.1p00.f${String(hour).padStart(3, "0")}`);
    expect(first!.url).toContain("lev_250_mb=on");
    expect(second!.cycle.getTime()).toBe(first!.cycle.getTime() - 6 * 3600e3);
    expect(second!.hour).toBe(hour + 6);
  });
  test("a late NOMADS falls back to the run before, and an HTML answer is not a grid", async () => {
    const grib = new Uint8Array(2000); grib.set([0x47, 0x52, 0x49, 0x42]);
    expect(isGrib(grib)).toBe(true);
    expect(isGrib(new TextEncoder().encode("<html>Data file is not present</html>"))).toBe(false);
    const asked: string[] = [];
    const fetcher: typeof fetch = (async (url: string | URL | Request) => {
      asked.push(String(url));
      return asked.length === 1 ? new Response("<html>Data file is not present</html>", { status: 404 }) : new Response(grib);
    }) as typeof fetch;
    const res = await windResponse(new Date("2026-10-28T05:30:00Z"), fetcher);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-GFS-Cycle")).toBe("2026-10-27T18:00:00.000Z");
    expect(res.headers.get("X-GFS-Hour")).toBe("12");
    expect(asked.length).toBe(2);
    expect(new Uint8Array(await res.arrayBuffer()).length).toBe(2000);
  });
});
