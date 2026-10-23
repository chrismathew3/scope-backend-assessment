-- Defense in depth. The API already scopes every query in code; these
-- policies make the database refuse out-of-scope rows even if a query forgets.
--
-- Each API request runs in a transaction that calls
--   set_config('app.user_id', <user id>, true)
-- The app connects as role scope_app (created by src/db/migrate.ts), which
-- does not own the tables, so RLS always applies to it.

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')
$$;--> statement-breakpoint

-- Theaters the current user can read (any role), or every theater for a super admin.
CREATE OR REPLACE FUNCTION app_member_theater_ids() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM "user" u
      WHERE u.id = app_current_user_id() AND u.status = 'active' AND u.is_super_admin
    ) THEN coalesce((SELECT array_agg(t.id) FROM theater t), '{}')
    ELSE coalesce((
      SELECT array_agg(m.theater_id)
      FROM theater_membership m JOIN "user" u ON u.id = m.user_id
      WHERE m.user_id = app_current_user_id() AND u.status = 'active'
    ), '{}')
  END
$$;--> statement-breakpoint

-- Theaters where the current user is admin (every theater for a super admin).
CREATE OR REPLACE FUNCTION app_admin_theater_ids() RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM "user" u
      WHERE u.id = app_current_user_id() AND u.status = 'active' AND u.is_super_admin
    ) THEN coalesce((SELECT array_agg(t.id) FROM theater t), '{}')
    ELSE coalesce((
      SELECT array_agg(m.theater_id)
      FROM theater_membership m JOIN "user" u ON u.id = m.user_id
      WHERE m.user_id = app_current_user_id() AND u.status = 'active' AND m.role = 'admin'
    ), '{}')
  END
$$;--> statement-breakpoint

-- showtime: admins see everything in their theaters; viewers only active rows.
-- "(SELECT fn())" makes Postgres evaluate the function once per query, not per row.
ALTER TABLE showtime ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY showtime_read ON showtime FOR SELECT USING (
  theater_id = ANY ((SELECT app_admin_theater_ids())::text[])
  OR (theater_id = ANY ((SELECT app_member_theater_ids())::text[]) AND status = 'active')
);--> statement-breakpoint
CREATE POLICY showtime_insert ON showtime FOR INSERT
  WITH CHECK (theater_id = ANY ((SELECT app_admin_theater_ids())::text[]));--> statement-breakpoint
CREATE POLICY showtime_update ON showtime FOR UPDATE
  USING (theater_id = ANY ((SELECT app_admin_theater_ids())::text[]))
  WITH CHECK (theater_id = ANY ((SELECT app_admin_theater_ids())::text[]));--> statement-breakpoint

-- imports and their rows: theater admins only.
ALTER TABLE import ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY import_admin ON import FOR ALL
  USING (theater_id = ANY ((SELECT app_admin_theater_ids())::text[]))
  WITH CHECK (theater_id = ANY ((SELECT app_admin_theater_ids())::text[]));--> statement-breakpoint
ALTER TABLE import_row ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY import_row_admin ON import_row FOR ALL
  USING (EXISTS (SELECT 1 FROM import i WHERE i.id = import_id))
  WITH CHECK (EXISTS (SELECT 1 FROM import i WHERE i.id = import_id));--> statement-breakpoint

-- Grants for the app role. No DELETE on schedule data: archive instead.
GRANT USAGE ON SCHEMA public TO scope_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "user", theater, showtime, import, import_row TO scope_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON session, theater_membership TO scope_app;--> statement-breakpoint
-- Audit log is append-only for the app.
GRANT SELECT, INSERT ON audit_log TO scope_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM scope_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_user_id(), app_member_theater_ids(), app_admin_theater_ids() TO scope_app;
