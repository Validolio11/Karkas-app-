const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '../..');
const version = require(path.join(root, 'package.json')).version;
const output = path.join(root, 'release', `release-${version}`);
const archive = path.join(output, 'win-unpacked/resources/app.asar');
const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString());
assert.equal(pkg.version, version);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const verifiedFiles = [];
function verify(relative) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const file = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) verify(file);
    else {
      const expected = hash(fs.readFileSync(path.join(root, file)));
      assert.equal(hash(asar.extractFile(archive, path.normalize(file))), expected, `Packaged file differs: ${file}`);
      verifiedFiles.push({ file, sha256: expected });
    }
  }
}
verify('dist');
verify('electron');
assert.ok(!asar.listPackage(archive).some(name => /(?:^|[\\/])\.env(?:$|\.)/.test(name)), 'No environment secrets are packaged');
const installerName = `Karkas-Setup-${version}.exe`;
const installer = fs.readFileSync(path.join(output, installerName));
const sha512 = crypto.createHash('sha512').update(installer).digest('base64');
const manifest = `version: ${version}\nfiles:\n  - url: ${installerName}\n    sha512: ${sha512}\n    size: ${installer.length}\npath: ${installerName}\nsha512: ${sha512}\nreleaseDate: '${new Date().toISOString()}'\n`;
const manifestPath = path.join(output, 'latest.yml');
if (!fs.existsSync(manifestPath)) fs.writeFileSync(manifestPath, manifest);
const actual = fs.readFileSync(manifestPath, 'utf8');
assert.ok(actual.includes(`version: ${version}`) && actual.includes(installerName) && actual.includes(sha512));
const assets = [installerName, `${installerName}.blockmap`, 'latest.yml'].map(name => {
  const bytes = fs.readFileSync(path.join(output, name));
  return { name, size: bytes.length, sha256: hash(bytes) };
});
fs.writeFileSync(path.join(__dirname, 'artifact-verification.json'), JSON.stringify({ passed: true, version,
  packagedFileCount: verifiedFiles.length, verifiedFiles, assets, installerSha512: sha512 }, null, 2));
console.log(`PASS ${verifiedFiles.length} packaged files, version ${version}, installer and update manifest`);
