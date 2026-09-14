-- Apply only to the disposable umami_upgrade database before upgrading from 3.0.3.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'umami_upgrade' THEN
    RAISE EXCEPTION 'This fixture requires the disposable umami_upgrade database';
  END IF;
END $$;

INSERT INTO website (website_id, name, domain, user_id)
SELECT '33100000-0000-4000-8000-000000000001', 'Upgrade review', 'localhost', user_id
FROM "user" WHERE username = 'admin';

INSERT INTO session (session_id, website_id)
VALUES ('33100000-0000-4000-8000-000000000002', '33100000-0000-4000-8000-000000000001');

INSERT INTO session_data
  (session_data_id, website_id, session_id, data_key, string_value, data_type, created_at)
VALUES
  ('33100000-0000-4000-8000-000000000003', '33100000-0000-4000-8000-000000000001',
   '33100000-0000-4000-8000-000000000002', 'role', 'old-role', 1, '2026-01-01'),
  ('33100000-0000-4000-8000-000000000004', '33100000-0000-4000-8000-000000000001',
   '33100000-0000-4000-8000-000000000002', 'role', 'current-role', 1, '2026-01-02');

INSERT INTO website_event (event_id, website_id, session_id, visit_id, url_path, event_type)
VALUES ('33100000-0000-4000-8000-000000000005', '33100000-0000-4000-8000-000000000001',
        '33100000-0000-4000-8000-000000000002', '33100000-0000-4000-8000-000000000008',
        '/before-upgrade', 1);

INSERT INTO "user" (user_id, username, password, role)
SELECT '33100000-0000-4000-8000-000000000006', 'UpgradeReviewer', password, 'user'
FROM "user" WHERE username = 'admin';

COMMIT;
