import { readFileSync } from 'node:fs';
import path from 'node:path';

function readNextConfig() {
  return readFileSync(path.join(process.cwd(), 'next.config.ts'), 'utf8');
}

test('Next build config keeps production build concurrency conservative', () => {
  const nextConfig = readNextConfig();

  expect(nextConfig).toContain('staticGenerationMaxConcurrency: 1');
  expect(nextConfig).toContain('webpackBuildWorker: false');
  expect(nextConfig).toContain('webpackMemoryOptimizations: true');
});
