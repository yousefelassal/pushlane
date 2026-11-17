ALTER TABLE installations ADD COLUMN endpoint_fingerprint text NOT NULL DEFAULT '';
ALTER TABLE installations ALTER COLUMN endpoint_fingerprint DROP DEFAULT;
