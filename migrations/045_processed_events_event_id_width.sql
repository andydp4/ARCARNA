-- InventoryWorker now claims events by inserting into processed_events, whose
-- composite primary key (event_id, worker_name) makes the idempotency guard
-- atomic. The previous guard was a plain SELECT on inventory_movements.event_id
-- with no unique constraint behind it, so two concurrent deliveries of the same
-- event both passed it and stock was deducted twice.
--
-- event_id was varchar(36) (UUID-sized). Real events are UUIDs, but any longer
-- identifier made the claim insert throw rather than skip, turning a duplicate
-- delivery into a failed event. Widen it so the claim can never fail on length.
ALTER TABLE processed_events
  ALTER COLUMN event_id TYPE varchar(255);
