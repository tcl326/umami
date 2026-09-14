# Umami 3.3.1 Upgrade

Branch: `upgrade/umami-3.3.1`. Upstream tag: `v3.3.1` (`ca661c705`).
Previous fork: `v3.0.3-basepath-acree.6` (`77b29a337`).

The merge imports the upstream session-data upsert and its uniqueness migration.
Analytics application code remains identical to upstream. The fork retains
`/analytics`, the ACR mirror/GeoIP build arguments, conservative build settings,
and writable container paths. The ACR Dockerfile now uses upstream's pnpm
11.21.0, Prisma configuration, `docker/proxy.ts`, and shell entrypoint. Existing
fork tests use upstream's Vitest runner.

## Build

Use Node 22.13+ and pnpm 11.21.0. The local test run used Node 22.23.2.
Use a dedicated builder with at least 4 GiB RAM. A shared 2 GiB Docker VM
OOM-killed Next.js during verification; the host production build passed.

```sh
pnpm install --frozen-lockfile
DATABASE_URL=postgresql://user:pass@localhost:5432/dummy pnpm test
BASE_PATH=/analytics DATABASE_URL=postgresql://user:pass@localhost:5432/dummy pnpm build-docker
docker build -f Dockerfile.acree -t umami:3.3.1-basepath-review .
```

ACR should use `Dockerfile.acree` and the ECS architecture (normally
`linux/amd64`). Keep the current `CHINA_*` arguments, including any GeoIP URL
override. Local image verification uses `linux/arm64` with `node:22-alpine`
and `https://registry.npmjs.org/` overrides. Do not publish this local ARM image
as an AMD64 production image.

## Verification

- 100 Vitest files / 748 tests passed under Node 22.
- Production application build and GeoIP download passed.
- ACR Dockerfile built successfully on the isolated 4 GiB builder. The ARM64
  review image is `umami:3.3.1-basepath-review` (image ID `105539553f8b`). Its
  normal entrypoint applied migrations 15-24 to the old-version test database
  and started successfully as the non-root runtime user.
- All ten new migrations applied to a disposable database initialized by the
  old 3.0.3 image. Existing events survived, the newest duplicate property was
  retained, and the mixed-case fixture username was normalized.
- 75 concurrent HTTP identify requests passed with stable property IDs,
  updated values, and no duplicates. A subsequent pageview was persisted.
- Current and cached production trackers passed identify, pageview, and
  account-switch checks under `/analytics`.
- Existing admin login and website display passed at 1440px and 390px.
- Scoped lint passed. Full upstream lint reports a hook-naming error in the
  unchanged `src/app/not-found.tsx`, plus existing warnings. Upstream's Next
  configuration skips full application type validation during builds.

Reproduce the migration fixture only on a disposable `umami_upgrade` database:

1. Initialize it with the old image's `scripts/check-db.js`.
2. Apply `scripts/upgrade-3.3.1-fixture.sql` with `psql -v ON_ERROR_STOP=1`.
3. Run `DATABASE_URL=<local-test-db> pnpm exec prisma migrate deploy`.
4. Start the upgraded application under `/analytics` on port 3311.
5. Run `DATABASE_URL=<local-test-db> node scripts/verify-upgrade-3.3.1.mjs`.
6. Run `node scripts/verify-upgrade-browser.mjs https://sales.railmart.net/analytics/script.js`.

The last command only reads the production script; all collection writes go
to localhost. Browser screenshots are in `test-results/upgrade-3.3.1/`.

The running container review is at `http://127.0.0.1:3311/analytics/login`,
with disposable credentials `admin` / `umami`. It uses Docker context
`colima-umami-upgrade`, containers `umami-upgrade-331-app` and
`umami-upgrade-331-db`, and database port 55440. The default Docker context
and existing LCL services were left running. Stop this review with
`colima stop --profile umami-upgrade` when finished.

## Rollout

The current production `FLOW_UMAMI_IMAGE` and its ACR build job still need to
be identified. No remote branch, image, pipeline, or production setting has
been changed by this preparation.

1. Build and test a new immutable image tag for the production architecture.
2. Take and verify a backup of the Umami database; retain the old image digest.
3. Pause Umami collection during the migration so old writers cannot race the
   new uniqueness constraint. Deploy the new image via `FLOW_UMAMI_IMAGE`.
4. Check container startup logs: the entrypoint runs all pending migrations
   before starting the server. Preserve `UMAMI_DATABASE_URL`, `UMAMI_APP_SECRET`,
   and `UMAMI_BASE_PATH=/analytics`. No LCL frontend rebuild is required.
5. Verify login, existing analytics, and both identify and event requests
   returning 200, then monitor for collection errors.

Migrations 15-24 include duplicate session-property cleanup, a unique index,
session-link/replay/2FA tables, and username normalization. The duplicate cleanup
deletes older values for the same session/key. Rolling back the image alone
does not undo these data changes; a full rollback requires the database backup.
