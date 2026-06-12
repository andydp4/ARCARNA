-- locations.state was varchar(2) (US state-code leftover), but the UI field is
-- labeled "County/Region" (UK). Widen to fit real county/region names.
ALTER TABLE locations ALTER COLUMN state TYPE varchar(100);
