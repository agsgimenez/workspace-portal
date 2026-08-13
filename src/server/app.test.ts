import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PortalConfig } from "../shared/contracts.js";
import { buildApp } from "./app.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL7WQAAAABJRU5ErkJggg==", "base64");

const config: PortalConfig = {
  title: "Test portal",
  roots: [{ path: "projects", label: "Projects", kind: "projects" }],
  excludeSegments: ["node_modules"],
  allowedExtensions: [".md", ".pdf", ".png"],
  allowedNames: [],
  maxFileBytes: 4096,
  maxImageBytes: 128,
  maxTreeEntries: 100,
  maxSearchResults: 20,
};

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "workspace-portal-api-"));
  await mkdir(path.join(root, "projects", "demo"), { recursive: true });
  await mkdir(path.join(root, "private"), { recursive: true });
  await writeFile(path.join(root, "projects", "demo", "README.md"), "# Demo\n\nVisible content");
  await writeFile(path.join(root, "projects", "demo", "manual.pdf"), Buffer.from("%PDF-1.4\npreview"));
  await writeFile(path.join(root, "projects", "demo", "preview.png"), png);
  await writeFile(path.join(root, "projects", "demo", "fake.png"), "not an image");
  await writeFile(path.join(root, "projects", "demo", "large.png"), Buffer.concat([png, Buffer.alloc(128)]));
  await writeFile(path.join(root, "private", "password.md"), "must not leak");
  const app = await buildApp({ workspaceRoot: root, config, serveWeb: false });
  return { app };
}

test("root tree only returns configured catalog roots", async () => {
  const { app } = await fixture();
  const response = await app.inject({ method: "GET", url: "/api/tree?path=" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().map((item: { name: string }) => item.name), ["projects"]);
  await app.close();
});

test("reads visible markdown and rejects private paths", async () => {
  const { app } = await fixture();
  const visible = await app.inject({ method: "GET", url: "/api/file?path=projects/demo/README.md" });
  assert.equal(visible.statusCode, 200);
  assert.match(visible.json().content, /Visible content/);
  const denied = await app.inject({ method: "GET", url: "/api/file?path=private/password.md" });
  assert.equal(denied.statusCode, 403);
  assert.doesNotMatch(denied.body, /must not leak/);
  await app.close();
});

test("security headers are present", async () => {
  const { app } = await fixture();
  const response = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.match(String(response.headers["content-security-policy"]), /frame-ancestors 'none'/);
  assert.equal(response.headers["x-ratelimit-limit"], "240");
  await app.close();
});

test("serves allowed PDF files inline without exposing arbitrary raw files", async () => {
  const { app } = await fixture();
  const pdf = await app.inject({ method: "GET", url: "/api/raw?path=projects/demo/manual.pdf" });
  assert.equal(pdf.statusCode, 200);
  assert.match(String(pdf.headers["content-type"]), /application\/pdf/);
  assert.equal(pdf.headers["content-disposition"], "inline");
  assert.match(String(pdf.headers["content-security-policy"]), /frame-ancestors 'self'/);
  const markdown = await app.inject({ method: "GET", url: "/api/raw?path=projects/demo/README.md" });
  assert.equal(markdown.statusCode, 415);
  assert.match(String(markdown.headers["content-security-policy"]), /frame-ancestors 'self'/);
  await app.close();
});

test("lists and serves validated images with a separate size limit", async () => {
  const { app } = await fixture();
  const tree = await app.inject({ method: "GET", url: "/api/tree?path=projects/demo" });
  assert.equal(tree.statusCode, 200);
  assert.ok(tree.json().some((item: { name: string }) => item.name === "preview.png"));

  const image = await app.inject({ method: "GET", url: "/api/raw?path=projects/demo/preview.png" });
  assert.equal(image.statusCode, 200);
  assert.match(String(image.headers["content-type"]), /image\/png/);
  assert.equal(image.headers["cache-control"], "private, no-store");
  assert.deepEqual(image.rawPayload, png);

  const textEndpoint = await app.inject({ method: "GET", url: "/api/file?path=projects/demo/preview.png" });
  assert.equal(textEndpoint.statusCode, 415);
  assert.equal(textEndpoint.json().error, "BINARY_FILE");

  const fake = await app.inject({ method: "GET", url: "/api/raw?path=projects/demo/fake.png" });
  assert.equal(fake.statusCode, 415);
  assert.equal(fake.json().error, "INVALID_IMAGE");

  const large = await app.inject({ method: "GET", url: "/api/raw?path=projects/demo/large.png" });
  assert.equal(large.statusCode, 413);
  assert.equal(large.json().error, "FILE_TOO_LARGE");
  await app.close();
});

test("search ignores visible binary images", async () => {
  const { app } = await fixture();
  const response = await app.inject({ method: "GET", url: "/api/search?q=Demo" });
  assert.equal(response.statusCode, 200);
  assert.ok(response.json().some((item: { name: string }) => item.name === "README.md"));
  await app.close();
});
