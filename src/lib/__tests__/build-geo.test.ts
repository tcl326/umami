import { readFileSync } from 'node:fs';
import path from 'node:path';

function readBuildGeoScript() {
  return readFileSync(path.join(process.cwd(), 'scripts/build-geo.js'), 'utf8');
}

test('Geo build script handles gzipped mmdb downloads and cached assets', () => {
  const buildGeo = readBuildGeoScript();

  expect(buildGeo).toContain("url.endsWith('.mmdb.gz')");
  expect(buildGeo).toContain('Geo database already present:');
  expect(buildGeo).toContain('downloadGzippedMmdb');
  expect(buildGeo).toContain('res.pipe(gunzip).pipe(fileStream)');
});
