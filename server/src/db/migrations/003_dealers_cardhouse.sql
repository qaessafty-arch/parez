-- FIB / CardHouse / dealer stock fields on transactions. Added by migration so
-- databases created before this change get the columns too.
ALTER TABLE transactions ADD COLUMN card_type TEXT;
ALTER TABLE transactions ADD COLUMN wholesale_cost_minor INTEGER;
ALTER TABLE transactions ADD COLUMN retail_price_minor INTEGER;
