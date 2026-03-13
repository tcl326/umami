import { readFileSync } from 'node:fs';
import path from 'node:path';

function readAcrEeDockerfile() {
  return readFileSync(path.join(process.cwd(), 'Dockerfile.acree'), 'utf8');
}

test('Dockerfile.acree uses China-friendly image and package mirror args', () => {
  const dockerfile = readAcrEeDockerfile();

  expect(dockerfile).toContain(
    'ARG CHINA_NODE_IMAGE="m.daocloud.io/docker.io/library/node:22-alpine"',
  );
  expect(dockerfile).toContain('ARG CHINA_NPM_REGISTRY="https://mirrors.cloud.tencent.com/npm/"');
  expect(dockerfile).toContain('ARG CHINA_ALPINE_MIRROR="https://mirrors.aliyun.com/alpine"');
  expect(dockerfile).toContain(
    'ARG CHINA_GEO_DATABASE_URL="https://raw.githubusercontent.com/GitSquared/node-geolite2-redist/master/redist/GeoLite2-City.tar.gz"',
  );

  expect(dockerfile).toContain('FROM ${CHINA_NODE_IMAGE} AS deps');
  expect(dockerfile).toContain('FROM ${CHINA_NODE_IMAGE} AS builder');
  expect(dockerfile).toContain('FROM ${CHINA_NODE_IMAGE} AS runner');

  expect(dockerfile).toContain('ENV GEO_DATABASE_URL=$CHINA_GEO_DATABASE_URL');
  expect(dockerfile).toContain('COREPACK_NPM_REGISTRY');
  expect(dockerfile).not.toContain('npm install -g pnpm');
});
