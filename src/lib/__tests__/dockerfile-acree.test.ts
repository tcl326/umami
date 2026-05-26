import { readFileSync } from 'node:fs';
import path from 'node:path';

function readDockerfile(filename: string) {
  return readFileSync(path.join(process.cwd(), filename), 'utf8');
}

test('Dockerfile.acree uses China-friendly image and package mirror args', () => {
  const dockerfile = readDockerfile('Dockerfile.acree');

  expect(dockerfile).toContain(
    'ARG CHINA_NODE_IMAGE="m.daocloud.io/docker.io/library/node:22-alpine"',
  );
  expect(dockerfile).toContain('ARG CHINA_NPM_REGISTRY="https://mirrors.cloud.tencent.com/npm/"');
  expect(dockerfile).toContain('ARG PNPM_VERSION="10.0.0"');
  expect(dockerfile).toContain('ARG CHINA_ALPINE_MIRROR="https://mirrors.aliyun.com/alpine"');
  expect(dockerfile).toContain(
    'ARG CHINA_GEO_DATABASE_URL="https://cdn.jsdelivr.net/npm/geolite2-city/GeoLite2-City.mmdb.gz"',
  );
  expect(dockerfile).toContain('ARG CHINA_GEO_DATABASE_URL_B64=""');

  expect(dockerfile).toContain('FROM ${CHINA_NODE_IMAGE} AS deps');
  expect(dockerfile).toContain('FROM ${CHINA_NODE_IMAGE} AS builder');
  expect(dockerfile).toContain('FROM ${CHINA_NODE_IMAGE} AS runner');

  expect(dockerfile).toContain('ENV GEO_DATABASE_URL=$CHINA_GEO_DATABASE_URL');
  // We decode CHINA_GEO_DATABASE_URL_B64 via Node so the build arg can be base64url and/or unpadded
  // (some build UIs reject '=' padding in KEY=VALUE style parameters).
  expect(dockerfile).toContain('process.env.CHINA_GEO_DATABASE_URL_B64');
  expect(dockerfile).toContain("Buffer.from(norm+pad,'base64')");
  expect(dockerfile).toContain('COREPACK_NPM_REGISTRY');
  expect(dockerfile).not.toContain('npm install -g pnpm');
  expect(dockerfile).toContain('corepack prepare pnpm@${PNPM_VERSION} --activate');
  expect(dockerfile).toContain('pnpm config set fetch-retries');
  expect(dockerfile).toContain('pnpm config set fetch-timeout');
  expect(dockerfile).toContain('pnpm config set child-concurrency 1');
  expect(dockerfile).toContain('pnpm config set network-concurrency 1');
  // The runner stage must not do any network-bound package adds/installs.
  // We keep all dependency resolution in the deps stage for deterministic CI builds.
  expect(dockerfile).not.toContain('pnpm add');
  expect(dockerfile).toContain('CMD ["npm", "run", "start-docker"]');
});

test.each(['Dockerfile', 'Dockerfile.acree'])('%s makes runtime paths writable', filename => {
  const dockerfile = readDockerfile(filename);

  expect(dockerfile).toContain('mkdir -p /home/nextjs/.cache');
  expect(dockerfile).toContain('chown -R nextjs:nodejs /app /home/nextjs');
});

test.each([
  'Dockerfile',
  'Dockerfile.acree',
])('%s allows Prisma runner dependency build scripts', filename => {
  const dockerfile = readDockerfile(filename);

  // Dockerfile uses pnpm's --allow-build; Dockerfile.acree pins pnpm@10 which doesn't support that flag.
  // For Dockerfile.acree we rely on package.json's pnpm.onlyBuiltDependencies to allow Prisma scripts.
  if (filename === 'Dockerfile') {
    expect(dockerfile).toContain("--allow-build=prisma --allow-build='@prisma/engines'");
  } else {
    expect(dockerfile).not.toContain('--allow-build');
  }
});
