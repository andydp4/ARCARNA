-- A2: Customer RFM segmentation (idempotent)
CREATE TABLE IF NOT EXISTS customer_rfm (
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  recency_score smallint NOT NULL,
  frequency_score smallint NOT NULL,
  monetary_score smallint NOT NULL,
  segment varchar(24) NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, customer_id)
);

CREATE INDEX IF NOT EXISTS customer_rfm_org_segment_idx ON customer_rfm (org_id, segment);
