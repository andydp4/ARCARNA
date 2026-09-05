/**
 * PM2 production config for the WM Supplies customer website process.
 *
 * Use this in a separate VPS folder built with .env.wm-supplies.example values:
 *   pm2 start ecosystem.wm-supplies.config.cjs
 *   pm2 save
 *
 * After editing .env, recreate the process so env_file is re-read:
 *   pm2 delete wm-supplies-website && pm2 start ecosystem.wm-supplies.config.cjs && pm2 save
 */
const path = require("path");

module.exports = {
  apps: [
    {
      name: "wm-supplies-website",
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
      out_file: path.join(__dirname, "logs", "wm-supplies-out.log"),
      error_file: path.join(__dirname, "logs", "wm-supplies-error.log"),
      merge_logs: true,
      time: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
