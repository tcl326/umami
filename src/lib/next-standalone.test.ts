import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

function readFile(filename: string) {
  return readFileSync(path.join(process.cwd(), filename), 'utf8');
}

test('Docker builds keep standalone output enabled for runtime image copies', () => {
  const nextConfig = readFile('next.config.ts');

  expect(nextConfig).toContain("output: isVercel ? undefined : 'standalone'");
});
