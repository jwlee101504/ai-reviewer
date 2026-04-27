import fs from "node:fs";
import yaml from "js-yaml";
import { ConfigSchema, type AppConfig } from "./schema.js";

export function loadConfig(path = process.env.CONFIG_PATH ?? "./config.yml"): AppConfig {
  const raw = fs.existsSync(path) ? yaml.load(fs.readFileSync(path, "utf8")) : {};
  return ConfigSchema.parse(raw);
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
