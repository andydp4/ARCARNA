-- v1.2.1 credit: "this customer already owes" at order start.
--
-- The till's usage record gains one kind, 'credit', with two labels: 'shown'
-- (the notice appeared) and 'paid' (a payment was taken from it). Like every
-- usage row it carries a role and a device, never a person, a customer or an
-- amount (owner decision Q18).
--
-- Idempotent: the check is dropped and re-added with the full list.
ALTER TABLE usage_events DROP CONSTRAINT IF EXISTS usage_events_kind_check;
ALTER TABLE usage_events ADD CONSTRAINT usage_events_kind_check
  CHECK (kind IN ('screen', 'message', 'call', 'crash', 'offline', 'funnel', 'credit'));
