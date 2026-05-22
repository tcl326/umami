import { readFileSync } from 'node:fs';
import path from 'node:path';

function readPackageJson() {
  return JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
}

test('Docker builds keep the turbo build path', () => {
  const pkg = readPackageJson();

  expect(pkg.scripts['build-app']).toBe('next build --turbo');
  expect(pkg.scripts['build-docker']).toContain('build-app');
  expect(pkg.pnpm.onlyBuiltDependencies).toEqual(
    expect.arrayContaining(['@prisma/client', '@prisma/engines', 'prisma']),
  );
});
