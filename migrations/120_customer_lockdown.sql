-- Customer data lockdown and delivery addresses (v1.2 Phase 5).
-- Re-applied on every deploy, so every statement is idempotent.

-- 1. The delivery address belongs to the order (PRV-05). The till, the
--    website and every edit path write here; the customer's saved address is
--    only copied in when someone chooses "Use saved address" (logged).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address varchar(1024);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_postcode varchar(16);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_notes varchar(500);

-- The manager's past-order summary counts a customer's orders, and the
-- board's phone search joins orders to customers: both read by customer.
CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON orders (customer_id);

-- 2. The formatted phone (PRV-06): +44 E.164, so "07700 900123",
--    "+44 7700 900123" and "447700900123" are one number. Kept by a trigger
--    rather than by each writer: customers are written from the engine, the
--    storage layer, WhatsApp, imports and the workers, and a lookup column
--    that one of them forgets is a lookup that silently misses. The same rule
--    lives in shared/customerView.ts (formatUkPhone); a DB test holds the two
--    together.
CREATE OR REPLACE FUNCTION arcarna_format_uk_phone(raw text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d ~ '^0044[1-9][0-9]{8,9}$' THEN '+' || substr(d, 3)
    WHEN d ~ '^44[1-9][0-9]{8,9}$' THEN '+' || d
    -- "+44 (0)7700 900123": the bracketed trunk zero is written, not dialled.
    WHEN d ~ '^440[1-9][0-9]{8,9}$' THEN '+44' || substr(d, 4)
    WHEN d ~ '^0[1-9][0-9]{8,9}$' THEN '+44' || substr(d, 2)
    WHEN d ~ '^7[0-9]{9}$' THEN '+44' || d
    ELSE NULL
  END
  FROM (SELECT regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g') AS d) AS digits
$$;

ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone_e164 varchar(20);

CREATE OR REPLACE FUNCTION customers_set_phone_e164() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.phone_e164 := arcarna_format_uk_phone(NEW.phone);
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS customers_phone_e164_trg ON customers;
CREATE TRIGGER customers_phone_e164_trg
  BEFORE INSERT OR UPDATE OF phone ON customers
  FOR EACH ROW EXECUTE FUNCTION customers_set_phone_e164();

UPDATE customers
   SET phone_e164 = arcarna_format_uk_phone(phone)
 WHERE phone_e164 IS DISTINCT FROM arcarna_format_uk_phone(phone);

CREATE INDEX IF NOT EXISTS customers_org_phone_e164_idx
  ON customers (org_id, phone_e164)
  WHERE phone_e164 IS NOT NULL;

-- 3. Who created the record, for the staff report. NULL on older rows and on
--    rows nobody signed in created (website, WhatsApp).
ALTER TABLE customers ADD COLUMN IF NOT EXISTS created_by_user_id varchar(255);

-- 4. A website order that half-matched someone (phone or email, not both) is
--    attached to a new record flagged for an admin to merge, never to the
--    half-match: a shared family phone is not the same person.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS possible_duplicate_of uuid;

-- 5. Each approved shop account is linked to one customer record.
ALTER TABLE allowed_users ADD COLUMN IF NOT EXISTS customer_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'allowed_users_customer_id_customers_id_fk'
  ) THEN
    ALTER TABLE allowed_users
      ADD CONSTRAINT allowed_users_customer_id_customers_id_fk
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
  END IF;
END $$;
