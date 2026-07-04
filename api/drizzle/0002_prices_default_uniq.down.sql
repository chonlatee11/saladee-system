-- Hand-written reverse of 0002_prices_default_uniq.sql (Pitfall 3: drizzle-kit
-- emits no down). IF EXISTS keeps the down idempotent so up->down->up leaves no
-- residue. Must run BEFORE 0001_commerce.down.sql (which drops the prices table).
DROP INDEX IF EXISTS "prices_default_uniq";
