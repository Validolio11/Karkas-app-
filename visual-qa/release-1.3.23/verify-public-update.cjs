const fs = require('node:fs');
const path = require('node:path');
const { resolveTrustedUpdate, verifyUpdateFile } = require('../../electron/update-trust.cjs');

(async () => {
  const version = '1.3.23';
  const fileName = `Karkas-Setup-${version}.exe`;
  const url = `https://github.com/Validolio11/Karkas-app-/releases/download/${version}/${fileName}`;
  const trusted = await resolveTrustedUpdate({ url, fileName, currentVersion: '1.3.22', signal: AbortSignal.timeout(30000) });
  await verifyUpdateFile(path.resolve(__dirname, '../../release', `release-${version}`, fileName), trusted);
  const result = { passed: true, fromVersion: '1.3.22', version, fileName, url, size: trusted.size, sha512: trusted.sha512 };
  fs.writeFileSync(path.join(__dirname, 'public-update-verification.json'), JSON.stringify(result, null, 2));
  console.log(`PASS public update from 1.3.22 to ${version}: trusted release, manifest and local installer match`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
