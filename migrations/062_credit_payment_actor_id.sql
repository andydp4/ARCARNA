-- Credit payments are recorded by login user, not by a UUID business entity.
--
-- Users in this app are keyed by auth-subject strings (`seed-cashier`,
-- Clerk `user_...`, legacy Replit subjects). Migration 053 accidentally made
-- credit_payments.recorded_by_user_id a uuid, so every settlement recorded by
-- a normal authenticated user could fail at insert time with "invalid input
-- syntax for type uuid" before the credit balance came down.
ALTER TABLE credit_payments
  ALTER COLUMN recorded_by_user_id TYPE varchar(255)
  USING recorded_by_user_id::text;
