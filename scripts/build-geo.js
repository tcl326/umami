/* eslint-disable no-console */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import https from 'https';
import tar from 'tar';
import zlib from 'zlib';

if (process.env.VERCEL && !process.env.BUILD_GEO) {
  console.log('Vercel environment detected. Skipping geo setup.');
  process.exit(0);
}

const db = 'GeoLite2-City';

const getUrlPathname = urlString => {
  try {
    return new URL(urlString).pathname;
  } catch {
    return urlString;
  }
};

const envGeoDatabaseUrl = process.env.GEO_DATABASE_URL;

// Always try the configured URL first, but keep a fallback list so that
// one bad/expired mirror URL doesn't break the whole build.
const urlsToTry = [
  envGeoDatabaseUrl,
  // If a MaxMind license key is provided, also try the official source.
  process.env.MAXMIND_LICENSE_KEY
    ? `https://download.maxmind.com/app/geoip_download?edition_id=${db}&license_key=${process.env.MAXMIND_LICENSE_KEY}&suffix=tar.gz`
    : undefined,
  // A MaxMind-compatible City database in .mmdb.gz form.
  // We prefer this over .tar.gz because it downloads faster and avoids the
  // need to untar in constrained CI environments.
  'https://cdn.jsdelivr.net/npm/geolite2-city/GeoLite2-City.mmdb.gz',
  // Alternative jsDelivr domains occasionally work when cdn.jsdelivr.net is flaky/blocked.
  'https://fastly.jsdelivr.net/npm/geolite2-city/GeoLite2-City.mmdb.gz',
  'https://gcore.jsdelivr.net/npm/geolite2-city/GeoLite2-City.mmdb.gz',
  // Upstream historical fallback.
  `https://raw.githubusercontent.com/GitSquared/node-geolite2-redist/master/redist/${db}.tar.gz`,
].filter(Boolean);

const uniqueUrlsToTry = Array.from(new Set(urlsToTry));

const dest = path.resolve(process.cwd(), 'geo');

if (!fs.existsSync(dest)) {
  fs.mkdirSync(dest);
}

// Avoid redownloading large geo assets on every build.
const defaultFilename = path.join(dest, `${db}.mmdb`);
if (fs.existsSync(defaultFilename)) {
  console.log('Geo database already present:', defaultFilename);
  process.exit(0);
}

const isDirectMmdbUrl = url => getUrlPathname(url).endsWith('.mmdb');
const isGzippedMmdbUrl = url => getUrlPathname(url).endsWith('.mmdb.gz');

// Download handler for compressed tar.gz files
const downloadCompressed = url =>
  new Promise((resolve, reject) => {
    https
      .get(url, res => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} downloading geo archive`));
          res.resume();
          return;
        }

        const extract = tar.t();
        let pendingWrites = 0;
        let archiveFinished = false;

        const finishIfReady = () => {
          if (archiveFinished && pendingWrites === 0) {
            resolve();
          }
        };

        extract.on('entry', entry => {
          if (entry.path.endsWith('.mmdb')) {
            pendingWrites += 1;

            const filename = path.join(dest, path.basename(entry.path));
            const fileStream = fs.createWriteStream(filename);

            entry.pipe(fileStream);

            fileStream.on('finish', () => {
              console.log('Saved geo database:', filename);
              pendingWrites -= 1;
              finishIfReady();
            });

            fileStream.on('error', e => {
              reject(e);
            });

            return;
          }

          entry.resume();
        });

        extract.on('finish', () => {
          archiveFinished = true;
          finishIfReady();
        });

        extract.on('error', e => {
          reject(e);
        });

        res.on('error', e => {
          reject(e);
        });

        res.pipe(zlib.createGunzip({})).pipe(extract);
      })
      .on('error', reject);
  });

// Download handler for gzipped .mmdb files (.mmdb.gz).
const downloadGzippedMmdb = url =>
  new Promise((resolve, reject) => {
    https
      .get(url, res => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} downloading geo database`));
          res.resume();
          return;
        }

        // Always consume the full response and surface stream errors.
        // Otherwise the build can hang indefinitely if gunzip or the network
        // stream errors before the destination file stream finishes.
        res.on('error', reject);

        const filename = path.join(dest, `${db}.mmdb`);
        const fileStream = fs.createWriteStream(filename);

        const gunzip = zlib.createGunzip({});
        gunzip.on('error', reject);
        fileStream.on('error', reject);

        fileStream.on('finish', () => {
          console.log('Saved geo database:', filename);
          resolve();
        });

        res.pipe(gunzip).pipe(fileStream);
      })
      .on('error', reject);
  });

// Download handler for direct .mmdb files
const downloadDirect = (url, redirectsLeft = 5) =>
  new Promise((resolve, reject) => {
    https
      .get(url, res => {
        // Follow redirects
        if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode)) {
          const next = res.headers.location;
          res.resume();
          if (!next) return reject(new Error(`HTTP ${res.statusCode} redirect without location`));
          if (redirectsLeft <= 0)
            return reject(new Error('Too many redirects downloading geo database'));
          const resolved = next.startsWith('http') ? next : new URL(next, url).toString();
          return downloadDirect(resolved, redirectsLeft - 1)
            .then(resolve)
            .catch(reject);
        }

        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} downloading geo database`));
        }

        // Always write to the expected filename, regardless of the URL path/query.
        const filename = path.join(dest, `${db}.mmdb`);
        const fileStream = fs.createWriteStream(filename);

        res.on('error', reject);
        fileStream.on('error', reject);

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          console.log('Saved geo database:', filename);
          resolve();
        });
      })
      .on('error', reject);
  });

async function downloadWithFallback() {
  let lastError;

  for (const url of uniqueUrlsToTry) {
    try {
      if (isGzippedMmdbUrl(url)) {
        await downloadGzippedMmdb(url);
      } else if (isDirectMmdbUrl(url)) {
        await downloadDirect(url);
      } else {
        await downloadCompressed(url);
      }

      return;
    } catch (e) {
      lastError = e;
      // Keep logs short but actionable (important for CI systems with log size limits).
      console.warn('Geo download failed, trying next mirror:', url);
      console.warn(String(e?.message || e));
    }
  }

  throw lastError;
}

downloadWithFallback()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('Failed to download geo database:', e);
    process.exit(1);
  });
