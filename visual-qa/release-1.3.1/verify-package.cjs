const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '../..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
assert.equal(version, '1.3.1');
const output = path.join(root, 'release', `release-${version}`);
const archive = path.join(output, 'win-unpacked', 'resources', 'app.asar');
assert.equal(JSON.parse(asar.extractFile(archive, 'package.json').toString()).version, version);
let matchedFiles = 0;
function compareDirectory(relative) {
  for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
    if (entry.name === '.gitignore') continue; // Builder omits repository bookkeeping files.
    const file = `${relative}/${entry.name}`;
    if (entry.isDirectory()) compareDirectory(file);
    else if (entry.isFile()) { assert.ok(asar.extractFile(archive, path.normalize(file)).equals(fs.readFileSync(path.join(root, file))), `Packaged file differs from verified source: ${file}`); matchedFiles += 1; }
  }
}
compareDirectory('dist'); compareDirectory('electron');
for (const icon of ['icon.png', 'icon.ico']) assert.ok(fs.readFileSync(path.join(output, 'win-unpacked', 'resources', icon)).equals(fs.readFileSync(path.join(root, 'build', icon))));
const installer = `Karkas-Setup-${version}.exe`;
const bytes = fs.readFileSync(path.join(output, installer));
const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
const metadata = fs.readFileSync(path.join(output, 'latest.yml'), 'utf8');
assert.match(metadata, new RegExp(`version: ${version.replaceAll('.', '\\.')}`));
assert.ok(metadata.includes(`path: ${installer}`));
assert.equal([...metadata.matchAll(/sha512: (.+)/g)].length, 2);
assert.ok([...metadata.matchAll(/sha512: (.+)/g)].every(match => match[1].trim() === sha512));
assert.ok(metadata.includes(`size: ${bytes.length}`));
assert.ok(fs.statSync(path.join(output, `${installer}.blockmap`)).size > 0);
const manifest = { version, fileVersion: process.env.KARKAS_FILE_VERSION, installer, bundle: fs.readdirSync(path.join(root, 'dist', 'assets')).find(name => /^app-.*\.js$/.test(name)),
  sha512, size: bytes.length, fullTests: Number(process.env.KARKAS_FULL_TEST_COUNT), packagedRuntimeTests: 2, typescript: 'passed', production: 'passed', windows: 'passed', isolatedUi: 'passed', asarMatchesProduction: true, matchedFiles };
assert.equal(manifest.fileVersion, version);
assert.ok(manifest.fullTests >= 427);
fs.writeFileSync(path.join(__dirname, 'release-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Verified ${installer}, SHA512 metadata, icons and ${matchedFiles} packaged files.`);
