-- Credit payments are recorded by the logged-in user account.
--
-- `users.id`, `orders.input_user_id`, and `orders.completed_user_id` are auth
-- subjects (Clerk/Replit/dev strings), not UUIDs. Leaving this as uuid makes
-- every credit settlement from a normal authenticated session fail before the
-- payment or commission release can be written.
DO $$
BEGIN
  IF to_regclass('public.credit_payments') IS NOT NULL THEN
    ALTER TABLE credit_payments
      ALTER COLUMN recorded_by_user_id TYPE varchar(255)
      USING recorded_by_user_id::text;
  END IF;
END $$;
