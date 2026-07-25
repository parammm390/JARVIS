-- D5.T1: map-ready household locations plus an explicit authenticated-user to
-- technician link. Coordinates are nullable because no location may be inferred.
ALTER TABLE finnor_os.households
  ADD COLUMN IF NOT EXISTS latitude real,
  ADD COLUMN IF NOT EXISTS longitude real;

ALTER TABLE finnor_os.households
  DROP CONSTRAINT IF EXISTS households_latitude_range;
ALTER TABLE finnor_os.households
  ADD CONSTRAINT households_latitude_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
ALTER TABLE finnor_os.households
  DROP CONSTRAINT IF EXISTS households_longitude_range;
ALTER TABLE finnor_os.households
  ADD CONSTRAINT households_longitude_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

ALTER TABLE finnor_os.users
  ADD COLUMN IF NOT EXISTS technician_id uuid REFERENCES finnor_os.technicians(id);
CREATE INDEX IF NOT EXISTS users_tenant_technician_idx
  ON finnor_os.users(tenant_id, technician_id)
  WHERE technician_id IS NOT NULL;

-- Existing household/user RLS policies and finnor_app table grants already cover
-- added columns; no broad policy or privilege change is required.
