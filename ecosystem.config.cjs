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
 */
const path = require("path");
const fs = require("fs");

const envPath = path.join(__dirname, ".env");
const fileEnv = fs.existsSync(envPath)
  ? require("dotenv").parse(fs.readFileSync(envPath))
  : {};

module.exports = {
  apps: [
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
  ],
};
