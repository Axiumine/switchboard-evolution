const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { copyOldUserData, isUnusedUserData } = require('../user-data-migration');

const quiet = { info() {}, warn() {} };

function makeAppData() {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'switchboard-userdata-'));
  const old = path.join(appData, 'OmniboardV');
  fs.mkdirSync(path.join(old, 'Local Storage', 'leveldb'), { recursive: true });
  fs.writeFileSync(path.join(old, 'Local Storage', 'leveldb', '000003.log'), 'layout');
  fs.writeFileSync(path.join(old, 'Preferences'), '{}');
  fs.mkdirSync(path.join(old, 'Cache'));
  fs.writeFileSync(path.join(old, 'Cache', 'data_0'), 'x');
  fs.symlinkSync('host-1234', path.join(old, 'SingletonLock'));
  return { appData, old, target: path.join(appData, 'Switchboard Evolution') };
}

test('the first start copies the old settings into the folder Electron left empty', () => {
  const { appData, old, target } = makeAppData();
  try {
    // Electron makes the folder before main.js runs.
    fs.mkdirSync(target);
    assert.equal(copyOldUserData(target, [old], quiet), old);
    assert.equal(fs.readFileSync(path.join(target, 'Local Storage', 'leveldb', '000003.log'), 'utf8'), 'layout');
    assert.equal(fs.existsSync(path.join(target, 'Preferences')), true);
    assert.equal(fs.existsSync(path.join(target, 'Cache')), false);
    assert.equal(fs.existsSync(path.join(target, 'SingletonLock')), false);
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
  }
});

test('a missing folder, or one with only caches and a lock, counts as never used', () => {
  const { appData, old, target } = makeAppData();
  try {
    assert.equal(isUnusedUserData(target), true);
    fs.mkdirSync(path.join(target, 'GPUCache'), { recursive: true });
    fs.symlinkSync('host-1', path.join(target, 'SingletonLock'));
    assert.equal(isUnusedUserData(target), true);
    assert.equal(copyOldUserData(target, [old], quiet), old);
    assert.equal(fs.existsSync(path.join(target, 'Preferences')), true);
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
  }
});

test('a folder the app has already used is left as it is', () => {
  const { appData, old, target } = makeAppData();
  try {
    fs.mkdirSync(path.join(target, 'Local Storage'), { recursive: true });
    fs.writeFileSync(path.join(target, 'Preferences'), '{"mine":true}');
    assert.equal(isUnusedUserData(target), false);
    assert.equal(copyOldUserData(target, [old], quiet), null);
    assert.equal(fs.readFileSync(path.join(target, 'Preferences'), 'utf8'), '{"mine":true}');
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
  }
});

test('without an old folder nothing is copied; the first one that exists is used', () => {
  const { appData, old, target } = makeAppData();
  try {
    assert.equal(copyOldUserData(target, [path.join(appData, 'Missing')], quiet), null);
    assert.equal(fs.existsSync(target), false);
    assert.equal(copyOldUserData(target, [path.join(appData, 'Missing'), old], quiet), old);
    assert.equal(copyOldUserData(path.join(appData, 'Other'), [path.join(appData, 'Other')], quiet), null);
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
  }
});
