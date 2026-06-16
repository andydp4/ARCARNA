/**
 * PM2 production config for ARCARNA EPOS (Hostinger VPS).
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * After editing .env, RE-CREATE the process so env_file is re-read — there is no
 * dotenv fallback in the app, and `pm2 restart/reload --update-env` keeps the env
 * captured at creation (a changed CLERK_SECRET_KEY etc. would be silently ignored):
 *   pm2 delete arcarna-epos && pm2 start ecosystem.config.cjs && pm2 save
 *
 * (Process renamed midnight-epos → arcarna-epos with the ARCARNA infra wave;
 *  on a box still running the old name, `pm2 delete midnight-epos` once first.)
 */
const path = require("path");

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
        NODE_ENV: "production",
      },
      env_file: path.join(__dirname, ".env"),
      out_file: path.join(__dirname, "logs", "pm2-out.log"),
      error_file: path.join(__dirname, "logs", "pm2-error.log"),
      merge_logs: true,
      time: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
