import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;
const baseUrl = process.env.UMAMI_REVIEW_URL || 'http://127.0.0.1:3311/analytics';
assert.equal(new URL(connectionString).pathname, '/umami_upgrade');
for (const url of [connectionString, baseUrl]) {
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(url).hostname));
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const websiteId = '33100000-0000-4000-8000-000000000001';
const userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 UpgradeReview/${randomUUID()}`;
const metadata = {
  id: 'upgrade-reviewer',
  user_label: 'Upgrade Reviewer',
  role: 'sales',
  forwarder_id: '33100000-0000-4000-8000-000000000007',
  forwarder_name: 'Review Forwarder',
};

async function send(type, data, cache) {
  const response = await fetch(`${baseUrl}/api/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
      ...(cache ? { 'x-umami-cache': cache } : {}),
    },
    body: JSON.stringify({
      type,
      payload: {
        website: websiteId,
        hostname: 'localhost',
        url: '/upgrade-review',
        language: 'en-US',
        screen: '1440x900',
        id: metadata.id,
        ...(data ? { data } : {}),
      },
    }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(body.sessionId, 'The collection request must persist a session');
  return body;
}

async function properties(sessionId) {
  return prisma.sessionData.findMany({ where: { sessionId }, orderBy: { dataKey: 'asc' } });
}

try {
  const migrations = await prisma.$queryRawUnsafe(
    'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
  );
  assert.equal(migrations.length, 24);
  const oldProperties = await properties('33100000-0000-4000-8000-000000000002');
  assert.equal(oldProperties.length, 1);
  assert.equal(oldProperties[0].id, '33100000-0000-4000-8000-000000000004');
  assert.equal(oldProperties[0].stringValue, 'current-role');
  assert.ok(
    await prisma.websiteEvent.findUnique({
      where: { id: '33100000-0000-4000-8000-000000000005' },
    }),
  );
  assert.equal(
    (
      await prisma.user.findUnique({
        where: { id: '33100000-0000-4000-8000-000000000006' },
      })
    ).username,
    'upgradereviewer',
  );
  console.log(
    'PASS: 3.0.3 data survives all ten new migrations; duplicate properties retain the newest value.',
  );

  // No cache token: exercise concurrent first-time creation, as in separate tabs.
  const first = await Promise.all(Array.from({ length: 25 }, () => send('identify', metadata)));
  const { sessionId, cache } = first[0];
  assert.ok(first.every(result => result.sessionId === sessionId));
  const before = await properties(sessionId);
  assert.equal(before.length, Object.keys(metadata).length);

  await Promise.all(
    Array.from({ length: 50 }, (_, index) =>
      send(
        'identify',
        { ...metadata, role: 'manager', branch_id: 'review-branch' },
        index % 2 ? cache : undefined,
      ),
    ),
  );
  const after = await properties(sessionId);
  assert.equal(after.length, Object.keys(metadata).length + 1);
  for (const property of before) {
    assert.equal(after.find(row => row.dataKey === property.dataKey).id, property.id);
  }
  assert.equal(after.find(row => row.dataKey === 'role').stringValue, 'manager');
  console.log(
    'PASS: 75 concurrent identify requests; stable row IDs, updated values, and no duplicate properties.',
  );

  await send('event', undefined, cache);
  assert.ok(
    await prisma.websiteEvent.findFirst({ where: { sessionId, urlPath: '/upgrade-review' } }),
  );
  const duplicates = await prisma.$queryRawUnsafe(
    'SELECT session_id, data_key FROM session_data GROUP BY session_id, data_key HAVING count(*) > 1',
  );
  assert.equal(duplicates.length, 0);
  const script = await fetch(`${baseUrl}/script.js`);
  assert.equal(script.status, 200);
  assert.ok((await script.text()).includes('identify'));
  const login = await fetch(`${baseUrl}/login`);
  assert.equal(login.status, 200);
  console.log('PASS: pageview persistence, tracking script, and login page under /analytics.');
} finally {
  await prisma.$disconnect();
}
