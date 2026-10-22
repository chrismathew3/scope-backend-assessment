-- Demo reset v3: also clears the audit log and the title catalog, so each
-- reviewer starts from a clean history. The API writes the reset itself as the
-- first new audit entry. Outside DEMO_MODE the audit log stays append-only:
-- the app role still has no UPDATE or DELETE on it.
CREATE OR REPLACE FUNCTION app_demo_reset(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n_imports integer;
  n_showtimes integer;
BEGIN
  SELECT count(*) INTO n_imports FROM import;

  DELETE FROM audit_log;
  DELETE FROM import_row;
  DELETE FROM import;
  DELETE FROM showtime;
  DELETE FROM movie_title; -- refilled by the showtime trigger below

  UPDATE theater t SET
    name = x->>'name',
    location = x->>'location',
    timezone = x->>'timezone',
    archived_at = NULL,
    schedule_version = t.schedule_version + 1
  FROM jsonb_array_elements(payload->'theaters') x
  WHERE t.id = x->>'id';

  INSERT INTO showtime (
    id, theater_id, movie_title, movie_title_key, movie_status, auditorium, auditorium_key,
    start_time, end_time, language, format, rating, status, source_updated_at, archived_at,
    created_at, updated_at
  )
  SELECT
    s.id, s.theater_id, s.movie_title, s.movie_title_key, s.movie_status::movie_status, s.auditorium,
    s.auditorium_key, s.start_time, s.end_time, s.language, s.format, s.rating,
    s.status::showtime_status, s.source_updated_at, s.archived_at, s.updated_at, s.updated_at
  FROM jsonb_to_recordset(payload->'showtimes') AS s(
    id text, theater_id text, movie_title text, movie_title_key text, movie_status text,
    auditorium text, auditorium_key text, start_time timestamptz, end_time timestamptz,
    language text, format text, rating text, status text, source_updated_at timestamptz,
    archived_at timestamptz, updated_at timestamptz
  );
  GET DIAGNOSTICS n_showtimes = ROW_COUNT;

  -- People created during the demo go; their sessions and memberships cascade.
  DELETE FROM "user"
  WHERE id NOT IN (SELECT x->>'id' FROM jsonb_array_elements(payload->'users') x);

  -- Demo accounts get their original role and theaters back.
  UPDATE "user" u SET status = 'active', is_super_admin = (x->>'isSuperAdmin')::boolean, name = x->>'name'
  FROM jsonb_array_elements(payload->'users') x
  WHERE u.id = x->>'id';

  DELETE FROM theater_membership
  WHERE user_id IN (SELECT x->>'id' FROM jsonb_array_elements(payload->'users') x);

  INSERT INTO theater_membership (user_id, theater_id, role)
  SELECT x->>'id', m->>'theaterId', (m->>'role')::theater_role
  FROM jsonb_array_elements(payload->'users') x, jsonb_array_elements(x->'memberships') m;

  RETURN jsonb_build_object('showtimes', n_showtimes, 'imports', n_imports);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app_demo_reset(jsonb) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_demo_reset(jsonb) TO scope_app;
