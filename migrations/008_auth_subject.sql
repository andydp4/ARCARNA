-- Phase 12A: auth provider abstraction (keep replit_user_id for rollback)

ALTER TABLE allowed_users
  ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(32) NOT NULL DEFAULT 'replit',
  ADD COLUMN IF NOT EXISTS auth_user_id VARCHAR(255);

ALTER TABLE user_approval_requests
  ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(32) NOT NULL DEFAULT 'replit',
  ADD COLUMN IF NOT EXISTS auth_user_id VARCHAR(255);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(32) NOT NULL DEFAULT 'replit',
  ADD COLUMN IF NOT EXISTS auth_user_id VARCHAR(255);

UPDATE allowed_users
SET auth_user_id = replit_user_id, auth_provider = 'replit'
WHERE auth_user_id IS NULL;

UPDATE user_approval_requests
SET auth_user_id = replit_user_id, auth_provider = 'replit'
WHERE auth_user_id IS NULL;

UPDATE users
SET auth_user_id = COALESCE(replit_user_id, id), auth_provider = 'replit'
WHERE auth_user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS allowed_users_auth_user_id_uq
  ON allowed_users (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS allowed_users_email_idx ON allowed_users (email);
