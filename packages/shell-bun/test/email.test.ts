// send_email off the edge (#911): cloudflare:email's EmailMessage and the builder form both land
// as .eml files; nothing is sent.
import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSendEmail } from "../src/bindings/email.ts";
import { LocalWorkerLoader } from "../src/bindings/worker-loader.ts";
import { EmailMessage } from "../src/shims.ts";

const emls = (dir: string) => readdirSync(dir).sort().map((f) => readFileSync(join(dir, f), "utf8"));

test("an EmailMessage's raw MIME is written as is; the builder form is composed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-email-"));
  const mail = new LocalSendEmail(dir, "EMAIL", ["hi@example.com"]);
  const raw = "From: hi@example.com\r\nTo: you@example.com\r\nSubject: link\r\n\r\nhttps://example.com/verify\r\n";
  const { messageId } = await mail.send(new EmailMessage("hi@example.com", "you@example.com", raw));
  expect(messageId).toBeString();
  await mail.send({ from: { email: "hi@example.com", name: "Hi" }, to: ["a@example.com"], subject: "both", text: "plain", html: "<b>rich</b>" });
  const [first, second] = emls(dir);
  expect(first).toBe(raw);
  expect(second).toContain("From: Hi <hi@example.com>\r\nTo: a@example.com\r\nSubject: both");
  expect(second).toContain("multipart/alternative");
  expect(second).toContain("plain");
  expect(second).toContain("<b>rich</b>");
});

test("a sender outside allowedSenderAddresses is refused, as on the edge", async () => {
  const mail = new LocalSendEmail(mkdtempSync(join(tmpdir(), "rb-email-")), "EMAIL", ["hi@example.com"]);
  await expect(mail.send(new EmailMessage("evil@example.com", "you@example.com", "x"))).rejects.toThrow("allowed_sender_addresses");
});

test("dynamic code can import cloudflare:email", async () => {
  const loader = new LocalWorkerLoader(mkdtempSync(join(tmpdir(), "rb-loader-")));
  const w = loader.get("mail", () => ({
    mainModule: "main.js",
    modules: { "main.js": `import { EmailMessage } from "cloudflare:email";
      export default { fetch: () => new Response(new EmailMessage("a@x.dev", "b@x.dev", "raw").to) };` },
  }));
  expect(await (await w.getEntrypoint().fetch!("http://x/")).text()).toBe("b@x.dev");
});
