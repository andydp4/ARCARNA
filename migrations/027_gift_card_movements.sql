-- F4: Gift card ledger movements (idempotent)
CREATE TABLE IF NOT EXISTS gift_card_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id uuid NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id),
  refund_id uuid REFERENCES refunds(id),
  type varchar(16) NOT NULL
    CHECK (type IN ('issue', 'redeem', 'refund_credit', 'void', 'expire')),
  amount numeric(10, 2) NOT NULL,
  balance_after numeric(10, 2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gift_card_movements_card_id_idx ON gift_card_movements (gift_card_id);
CREATE INDEX IF NOT EXISTS gift_card_movements_order_id_idx ON gift_card_movements (order_id);
CREATE INDEX IF NOT EXISTS gift_card_movements_refund_id_idx ON gift_card_movements (refund_id);
