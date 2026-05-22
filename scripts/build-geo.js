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

// Support custom URL via environment variable
let url = process.env.GEO_DATABASE_URL;

// Fallback to default URLs if not provided
if (!url) {
  if (process.env.MAXMIND_LICENSE_KEY) {
    url =
      `https://download.maxmind.com/app/geoip_download` +
      `?edition_id=${db}&license_key=${process.env.MAXMIND_LICENSE_KEY}&suffix=tar.gz`;
  } else {
    url = `https://raw.githubusercontent.com/GitSquared/node-geolite2-redist/master/redist/${db}.tar.gz`;
  }
}

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

const isDirectMmdb = url.endsWith('.mmdb');
const isGzippedMmdb = url.endsWith('.mmdb.gz');

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
const downloadDirect = (url, originalUrl) =>
  new Promise((resolve, reject) => {
    https.get(url, res => {
      // Follow redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        downloadDirect(res.headers.location, originalUrl || url)
          .then(resolve)
          .catch(reject);
        return;
      }

      const filename = path.join(dest, path.basename(originalUrl || url));
      const fileStream = fs.createWriteStream(filename);

      res.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        console.log('Saved geo database:', filename);
        resolve();
      });

      fileStream.on('error', e => {
        reject(e);
      });
    });
  });

// Execute download based on file type
if (isGzippedMmdb) {
  downloadGzippedMmdb(url)
    .then(() => {
      process.exit(0);
    })
    .catch(e => {
      console.error('Failed to download geo database:', e);
      process.exit(1);
    });
} else if (isDirectMmdb) {
  downloadDirect(url)
    .then(() => {
      process.exit(0);
    })
    .catch(e => {
      console.error('Failed to download geo database:', e);
      process.exit(1);
    });
} else {
  downloadCompressed(url)
    .then(() => {
      process.exit(0);
    })
    .catch(e => {
      console.error('Failed to download geo database:', e);
      process.exit(1);
    });
}
