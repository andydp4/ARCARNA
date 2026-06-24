/**
 * PM2 production config for ARCARNA EPOS (Hostinger VPS).
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * .env is parsed here at config-eval time and merged into the env block below.
 * PM2 does NOT natively honor an `env_file` key (it silently ignores unknown
 * keys), and the app has no dotenv fallback, so without this the process would
 * launch with no DATABASE_URL etc. and crash on boot. Because the config is
 * re-evaluated on every `pm2 start`, a plain delete+start picks up .env changes:
 *   pm2 delete arcarna-epos && pm2 start ecosystem.config.cjs && pm2 save
 * (Note: `pm2 restart/reload` reuses the env captured at creation, so after
 *  editing .env you must delete+start, not restart, for changes to take effect.)
 *
 * (Process renamed midnight-epos → arcarna-epos with the ARCARNA infra wave;
 *  on a box still running the old name, `pm2 delete midnight-epos` once first.)
 *
 * Subdomain migration (arcarna.viger.cloud): a second app, "arcarna-epos-sub",
 * runs from .env.arcarna-subdomain — same checkout, different port, root-
 * mounted build (see docs/ops/SUBDOMAIN_MIGRATION_ARCARNA.md). Only declared
 * once that env file exists, so existing single-process deploys are unaffected.
 */
const path = require("path");
const fs = require("fs");

function loadEnvFile(relativeName) {
  const envPath = path.join(__dirname, relativeName);
  return fs.existsSync(envPath)
    ? require("dotenv").parse(fs.readFileSync(envPath))
    : null;
}

const fileEnv = loadEnvFile(".env") ?? {};
const subdomainEnv = loadEnvFile(".env.arcarna-subdomain");

const apps = [
  {
    name: "arcarna-epos",
    cwd: __dirname,
    script: path.join(__dirname, "dist", "index.js"),
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    max_memory_restart: "500M",
    watch: false,
    env: {
      ...fileEnv,
      NODE_ENV: "production",
    },
    out_file: path.join(__dirname, "logs", "pm2-out.log"),
    error_file: path.join(__dirname, "logs", "pm2-error.log"),
    merge_logs: true,
    time: true,
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
  },
];

if (subdomainEnv) {
  apps.push({
    name: "arcarna-epos-sub",
    cwd: __dirname,
    script: path.join(__dirname, "dist", "index.js"),
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    max_memory_restart: "500M",
    watch: false,
    env: {
      ...subdomainEnv,
      NODE_ENV: "production",
    },
    out_file: path.join(__dirname, "logs", "pm2-out-sub.log"),
    error_file: path.join(__dirname, "logs", "pm2-error-sub.log"),
    merge_logs: true,
    time: true,
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
  });
}

module.exports = { apps };
