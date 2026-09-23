-- One-time UI (What's New, the Operations tour, and the v1.2 tutorials to
-- come) remembered per ACCOUNT, not per browser.
--
-- Until now each of these kept its "seen" flag in localStorage, so it came
-- back on every new device, every other browser, the installed app vs the
-- browser tab, a private window, or after site data was cleared — the owner
-- saw them "every time you log in or switch device".
--
-- One row per person per thing seen. No foreign key to users: an account can
-- be signed in (Clerk / allow-list) before it has a users row, and a seen
-- marker must never be the thing that fails a login. Re-applied on every
-- deploy, so idempotent.
CREATE TABLE IF NOT EXISTS user_ui_seen (
  user_id varchar(255) NOT NULL,
  key varchar(128) NOT NULL,
  seen_at timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
