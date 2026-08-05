import path from "node:path";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const workspaceRoot = path.resolve(process.env.WORKSPACE_ROOT ?? "/workspace");
const configPath = path.resolve(process.env.WORKSPACE_PORTAL_CONFIG ?? path.join(process.cwd(), "workspace-portal.config.json"));
const port = Number(process.env.PORT ?? 4178);
const host = process.env.HOST ?? "127.0.0.1";

const config = await loadConfig(configPath);
const app = await buildApp({ workspaceRoot, config });
await app.listen({ host, port });
