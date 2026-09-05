-- Credit payments are recorded by the authenticated user, and user ids are
-- Clerk/Replit/dev auth subjects such as `user_...` or `seed-cashier`, not
-- UUIDs. A UUID column makes every non-UUID cashier/admin account settlement
-- fail at insert time, after the business has taken the customer's money.
ALTER TABLE credit_payments
  ALTER COLUMN recorded_by_user_id TYPE varchar(255)
  USING recorded_by_user_id::text;
