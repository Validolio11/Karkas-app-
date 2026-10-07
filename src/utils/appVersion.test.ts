import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareAppVersions, isNewerAppVersion, isValidAppVersion } from './appVersion';

test('installed or older releases never become an update including version prefixes and build metadata', () => {
  for (const version of ['1.2.23', 'v1.2.23', '  v1.2.23  ', '1.2.23+windows']) {
    assert.equal(isNewerAppVersion(version, '1.2.23'), false);
  }
  assert.equal(isNewerAppVersion('1.2.22', '1.2.23'), false);
  assert.equal(isNewerAppVersion('1.2.24', '1.2.23'), true);
  assert.equal(isNewerAppVersion('1.2.10', '1.2.9'), true);
});

test('invalid or unresolved versions cannot enable installer actions', () => {
  for (const value of ['', 'latest', 'v', '1.2.23bad', '1.2.23.4', '9999999999999999999.2.3',
    '01.2.99', '1.02.99', '1.2.23-beta.01', '1.2.23-beta.9999999999999999999']) {
    assert.equal(isValidAppVersion(value), false);
    assert.equal(compareAppVersions(value, '1.2.23'), null);
    assert.equal(isNewerAppVersion('1.2.24', value), false);
  }
});

test('prerelease ordering does not downgrade a stable installed version', () => {
  assert.equal(isNewerAppVersion('1.2.23-beta.2', '1.2.23'), false);
  assert.equal(isNewerAppVersion('1.2.23', '1.2.23-beta.2'), true);
  assert.equal(compareAppVersions('1.2.23-beta.10', '1.2.23-beta.2'), 1);
  assert.equal(compareAppVersions('1.2', '1.2.0'), 0);
});
