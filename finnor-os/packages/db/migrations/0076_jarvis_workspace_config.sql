-- Phase 3 JARVIS native workspace: minimal tenant-wide presentation controls.
-- The configuration lives on the existing tenant_settings row so every employee
-- in one tenant observes the same workspace vocabulary and surface posture. RLS
-- from migration 0024 remains the enforcement boundary.

ALTER TABLE finnor_os.tenant_settings
  ADD COLUMN IF NOT EXISTS workspace_config jsonb NOT NULL DEFAULT '{
    "enabledSurfaces": ["home", "work", "customers", "schedule", "money", "agents"],
    "terminology": {"home": "Home", "work": "Work", "customers": "Customers", "schedule": "Schedule", "money": "Money", "agents": "Agents"},
    "voiceEnabled": true,
    "navigationPriority": ["home", "work", "customers", "schedule", "money", "agents"],
    "brand": {"accent": "cyan", "radius": "soft", "mark": "F"},
    "visibility": {"policy": true, "authority": true}
  }'::jsonb;
