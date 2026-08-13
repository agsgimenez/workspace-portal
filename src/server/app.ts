import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyRateLimit from "@fastify/rate-limit";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PortalConfig } from "../shared/contracts.js";
import { listProjects } from "./catalog.js";
import { PortalError } from "./errors.js";
import { readDocument, listTree, searchFiles } from "./files.js";
import { findRepository, listBranchTree, readBranchDocument, readBranchImage, repositoryInfo } from "./git.js";
import { inspectImage, isImageExtension } from "./images.js";
import { PathPolicy } from "./policy.js";

export interface AppOptions {
  workspaceRoot: string;
  config: PortalConfig;
  serveWeb?: boolean;
}

export async function buildApp(options: AppOptions) {
  const app = Fastify({ logger: true, trustProxy: false, bodyLimit: 1024 });
  const policy = new PathPolicy(options.workspaceRoot, options.config);

  await app.register(fastifyRateLimit, {
    global: true,
    max: 240,
    timeWindow: "1 minute",
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    const frameAncestors = request.url.startsWith("/api/raw?") ? "'self'" : "'none'";
    reply.header("Content-Security-Policy", `default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors ${frameAncestors}; base-uri 'none'; form-action 'none'`);
    return payload;
  });

  app.setErrorHandler((error, _request, reply) => {
    const portalError = error instanceof PortalError ? error : null;
    const statusCode = portalError?.statusCode ?? 500;
    if (!portalError) app.log.error(error);
    reply.status(statusCode).send({ error: portalError?.code ?? "INTERNAL_ERROR", message: portalError?.message ?? "Unexpected error" });
  });

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/api/config", async () => ({ title: options.config.title, roots: options.config.roots }));
  app.get("/api/projects", async () => listProjects(policy));
  app.get<{ Querystring: { path?: string } }>("/api/tree", async (request) => listTree(policy, request.query.path ?? ""));
  app.get<{ Querystring: { path?: string } }>("/api/file", async (request) => readDocument(policy, request.query.path));
  app.get<{ Querystring: { path?: string } }>("/api/raw", async (request, reply) => {
    const target = await policy.resolve(request.query.path, "file");
    if (path.extname(target.relative).toLowerCase() === ".pdf") {
      reply.type("application/pdf");
      reply.header("Content-Disposition", "inline");
      return reply.send(createReadStream(target.absolute));
    }

    const image = await inspectImage(policy, request.query.path);
    reply.type(image.mimeType);
    reply.header("Content-Disposition", "inline");
    reply.header("Content-Length", image.size);
    reply.header("Cache-Control", "private, no-store");
    return reply.send(createReadStream(image.absolute));
  });
  app.get<{ Querystring: { q?: string } }>("/api/search", async (request) => searchFiles(policy, request.query.q));
  app.get<{ Querystring: { path?: string } }>("/api/repository", async (request) => {
    const target = await policy.resolve(request.query.path ?? "");
    return findRepository(target.absolute, policy.workspaceRoot);
  });
  async function selectedRepository(repoInput: unknown) {
    const target = await policy.resolve(repoInput, "directory");
    const repository = await repositoryInfo(target.absolute, policy.workspaceRoot);
    if (!repository || repository.path !== target.relative) {
      throw new PortalError("Repository not found", 404, "REPOSITORY_NOT_FOUND");
    }
    return { target, repository };
  }
  app.get<{ Querystring: { repo?: string; branch?: string; path?: string } }>("/api/git/tree", async (request) => {
    const { target, repository } = await selectedRepository(request.query.repo);
    return listBranchTree(policy, target.absolute, repository, request.query.branch, request.query.path ?? "");
  });
  app.get<{ Querystring: { repo?: string; branch?: string; path?: string } }>("/api/git/file", async (request) => {
    const { target, repository } = await selectedRepository(request.query.repo);
    return readBranchDocument(policy, target.absolute, repository, request.query.branch, request.query.path);
  });
  app.get<{ Querystring: { repo?: string; branch?: string; path?: string } }>("/api/git/raw", async (request, reply) => {
    const { target, repository } = await selectedRepository(request.query.repo);
    if (typeof request.query.path !== "string" || !isImageExtension(request.query.path)) {
      throw new PortalError("Branch raw preview is only available for images", 415, "PREVIEW_DENIED");
    }
    const image = await readBranchImage(policy, target.absolute, repository, request.query.branch, request.query.path);
    reply.type(image.mimeType);
    reply.header("Content-Disposition", "inline");
    reply.header("Content-Length", image.buffer.length);
    reply.header("Cache-Control", "private, no-store");
    return reply.send(image.buffer);
  });

  if (options.serveWeb !== false) {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const webRoot = path.resolve(moduleDir, "../../web");
    await app.register(fastifyStatic, { root: webRoot, wildcard: false });
    app.get("/*", async (_request, reply) => reply.sendFile("index.html"));
  }

  return app;
}
