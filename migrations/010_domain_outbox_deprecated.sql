-- Mark legacy domain_outbox as deprecated (superseded by event_outbox).
-- Safe to re-run.
COMMENT ON TABLE domain_outbox IS 'DEPRECATED 2026 - superseded by event_outbox. Do not write here. Retained for historical rows; will be dropped in a future migration.';
