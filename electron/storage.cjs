const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const SCHEMA_VERSION = 2;
const WORKSPACE_FILE = 'workspace.json';
const PREFERENCES_FILE = 'preferences.json';
const MAX_WORKSPACE_BYTES = 30 * 1024 * 1024;
const MAX_PREFERENCES_BYTES = 256 * 1024;
const ENVELOPE_ALLOWANCE_BYTES = 4096;

class DesktopStorageError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'DesktopStorageError';
    this.code = code;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonSafe(value, label, limits = {}) {
  const maxDepth = limits.maxDepth ?? 32;
  const maxNodes = limits.maxNodes ?? 100000;
  const maxStringLength = limits.maxStringLength ?? 1024 * 1024;
  const seen = new Set();
  let nodes = 0;

  const visit = (current, depth) => {
    nodes += 1;
    if (nodes > maxNodes) throw new DesktopStorageError('INVALID_DATA', `${label} is too complex`);
    if (depth > maxDepth) throw new DesktopStorageError('INVALID_DATA', `${label} is nested too deeply`);
    if (current === null || typeof current === 'boolean') return;
    if (typeof current === 'string') {
      if (current.length > maxStringLength) throw new DesktopStorageError('INVALID_DATA', `${label} contains an oversized string`);
      return;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new DesktopStorageError('INVALID_DATA', `${label} contains a non-finite number`);
      return;
    }
    if (typeof current !== 'object') throw new DesktopStorageError('INVALID_DATA', `${label} must contain JSON values only`);
    if (seen.has(current)) throw new DesktopStorageError('INVALID_DATA', `${label} contains a circular reference`);
    seen.add(current);
    if (!Array.isArray(current) && !isPlainObject(current)) {
      throw new DesktopStorageError('INVALID_DATA', `${label} must contain plain objects only`);
    }
    const entries = Array.isArray(current) ? current.entries() : Object.entries(current);
    for (const [key, child] of entries) {
      if (!Array.isArray(current) && (key === '__proto__' || key === 'prototype' || key === 'constructor')) {
        throw new DesktopStorageError('INVALID_DATA', `${label} contains an unsafe key`);
      }
      visit(child, depth + 1);
    }
    seen.delete(current);
  };

  visit(value, 0);
}

function assertWorkspace(value) {
  if (!isPlainObject(value)) throw new DesktopStorageError('INVALID_DATA', 'Workspace must be an object');
  for (const field of ['tasks', 'tabs', 'deletedTasks']) {
    if (!Array.isArray(value[field])) throw new DesktopStorageError('INVALID_DATA', `Workspace.${field} must be an array`);
  }
  if (!isPlainObject(value.settings)) throw new DesktopStorageError('INVALID_DATA', 'Workspace.settings must be an object');
  if (value.tasks.length > 50000 || value.deletedTasks.length > 50000 || value.tabs.length > 500) {
    throw new DesktopStorageError('INVALID_DATA', 'Workspace collection limit exceeded');
  }
  assertJsonSafe(value, 'Workspace');
}

function assertOwner(owner) {
  if (owner === null) return;
  if (typeof owner !== 'string' || owner.length === 0 || owner.length > 256 || /[\0-\x1f\x7f]/.test(owner)) {
    throw new DesktopStorageError('INVALID_OWNER', 'Account owner must be null or a valid non-empty string');
  }
}

function assertSyncOperations(value, label) {
  if (!Array.isArray(value) || value.length > 10000) {
    throw new DesktopStorageError('INVALID_DATA', `${label} must be an operations array`);
  }
  for (const operation of value) {
    if (!isPlainObject(operation) || !['task', 'tab', 'settings'].includes(operation.kind)) {
      throw new DesktopStorageError('INVALID_DATA', `${label} contains an invalid operation`);
    }
    if (operation.kind === 'settings') {
      if (operation.id !== undefined || operation.lifecycle !== undefined) {
        throw new DesktopStorageError('INVALID_DATA', `${label} contains invalid settings metadata`);
      }
    } else {
      if (typeof operation.id !== 'string' || operation.id.length === 0 || operation.id.length > 512) {
        throw new DesktopStorageError('INVALID_DATA', `${label} contains an invalid entity id`);
      }
      const lifecycles = operation.kind === 'task' ? ['active', 'deleted', 'purged'] : ['active', 'deleted'];
      if (operation.lifecycle !== undefined && !lifecycles.includes(operation.lifecycle)) {
        throw new DesktopStorageError('INVALID_DATA', `${label} contains an invalid lifecycle`);
      }
    }
    if (operation.patch !== undefined && !isPlainObject(operation.patch)) {
      throw new DesktopStorageError('INVALID_DATA', `${label} contains an invalid patch`);
    }
    if (operation.patch && Object.hasOwn(operation.patch, 'id')) {
      throw new DesktopStorageError('INVALID_DATA', `${label} cannot patch an entity id`);
    }
    if (operation.unset !== undefined && (!Array.isArray(operation.unset) || operation.unset.length > 100 ||
        operation.unset.some((field) => typeof field !== 'string' || field.length === 0 || field.length > 100 ||
          field === 'id' || field === '__proto__' || field === 'prototype' || field === 'constructor'))) {
      throw new DesktopStorageError('INVALID_DATA', `${label} contains invalid unset fields`);
    }
    if (operation.lifecycle === undefined && operation.patch === undefined && operation.unset === undefined) {
      throw new DesktopStorageError('INVALID_DATA', `${label} contains an empty operation`);
    }
  }
  assertJsonSafe(value, label);
}

// Owner identifiers remain logical map keys and are never interpolated into file paths.
function ownerMapKey(owner) {
  assertOwner(owner);
  return owner === null ? '$guest' : `$user:${owner}`;
}

function assertAccount(account, label = 'Account') {
  if (!isPlainObject(account)) throw new DesktopStorageError('INVALID_DATA', `${label} must be an object`);
  assertWorkspace(account.workspace);
  for (const field of ['base', 'recovery']) {
    if (account[field] !== undefined && account[field] !== null) assertWorkspace(account[field]);
  }
  if (account.lastSyncTime !== undefined && account.lastSyncTime !== null &&
      (!Number.isFinite(account.lastSyncTime) || account.lastSyncTime < 0)) {
    throw new DesktopStorageError('INVALID_DATA', `${label}.lastSyncTime must be a non-negative number or null`);
  }
  if (account.syncClientId !== undefined &&
      (typeof account.syncClientId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(account.syncClientId))) {
    throw new DesktopStorageError('INVALID_DATA', `${label}.syncClientId is invalid`);
  }
  if (account.nextSyncSequence !== undefined &&
      (!Number.isSafeInteger(account.nextSyncSequence) || account.nextSyncSequence < 0)) {
    throw new DesktopStorageError('INVALID_DATA', `${label}.nextSyncSequence is invalid`);
  }
  for (const syncField of ['pendingSync', 'inFlightSync']) {
    if (account[syncField] === undefined || account[syncField] === null) continue;
    const pending = account[syncField];
    if (!isPlainObject(pending) || typeof pending.mutationId !== 'string' ||
        typeof pending.clientId !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(pending.clientId) ||
        !Number.isSafeInteger(pending.sequence) || pending.sequence < 1 ||
        !Number.isSafeInteger(pending.attempts) || pending.attempts < 0 ||
        !Number.isFinite(pending.createdAt) || pending.createdAt < 0 ||
        !Number.isFinite(pending.nextAttemptAt) || pending.nextAttemptAt < 0 ||
        pending.mutationId !== `${pending.clientId}:${pending.sequence}` ||
        (pending.lastError !== undefined && (typeof pending.lastError !== 'string' || pending.lastError.length > 500))) {
      throw new DesktopStorageError('INVALID_DATA', `${label}.${syncField} is invalid`);
    }
    if (account.syncClientId !== undefined && account.syncClientId !== pending.clientId) {
      throw new DesktopStorageError('INVALID_DATA', `${label}.${syncField} belongs to another sync client`);
    }
    if (account.nextSyncSequence !== undefined && account.nextSyncSequence < pending.sequence) {
      throw new DesktopStorageError('INVALID_DATA', `${label}.${syncField} sequence exceeds the account watermark`);
    }
    if (pending.operations !== undefined) assertSyncOperations(pending.operations, `${label}.${syncField}.operations`);
    assertWorkspace(pending.workspace);
    if (pending.base !== undefined && pending.base !== null) assertWorkspace(pending.base);
  }
}

function assertAccountStore(value) {
  if (!isPlainObject(value) || !isPlainObject(value.accounts)) {
    throw new DesktopStorageError('INVALID_DATA', 'Account store must contain an accounts object');
  }
  assertOwner(value.activeOwner);
  const entries = Object.entries(value.accounts);
  if (entries.length > 100) throw new DesktopStorageError('INVALID_DATA', 'Account limit exceeded');
  for (const [key, account] of entries) {
    if (key !== '$guest' && !key.startsWith('$user:')) {
      throw new DesktopStorageError('INVALID_DATA', 'Account store contains an invalid owner key');
    }
    assertAccount(account, `Account ${key}`);
  }
  assertJsonSafe(value, 'Account store');
}

function emptyAccountStore() {
  return { activeOwner: null, accounts: {} };
}

function assertPreferences(value) {
  if (!isPlainObject(value)) throw new DesktopStorageError('INVALID_DATA', 'Preferences must be an object');
  if (Object.keys(value).length > 256) throw new DesktopStorageError('INVALID_DATA', 'Preference key limit exceeded');
  assertJsonSafe(value, 'Preferences', { maxNodes: 10000, maxStringLength: 65536 });
}

function parseLegacyJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new DesktopStorageError('INVALID_LEGACY_DATA', 'Legacy data contains invalid JSON', error);
  }
}

/** Accepts either a WorkspaceState object or a snapshot of the old localStorage keys. */
function normalizeLegacyWorkspace(legacy) {
  if (!isPlainObject(legacy)) throw new DesktopStorageError('INVALID_LEGACY_DATA', 'Legacy workspace must be an object');
  if (Array.isArray(legacy.tasks) && Array.isArray(legacy.tabs) && Array.isArray(legacy.deletedTasks) && isPlainObject(legacy.settings)) {
    return legacy;
  }

  const tasks = parseLegacyJson(legacy.life_todo_tasks_v2 ?? legacy.ps_todo_tasks_v1, []);
  const tabs = parseLegacyJson(legacy.life_todo_tabs_v2, []);
  const deletedTasks = parseLegacyJson(legacy.karkas_deleted_tasks_v2, []);
  const bool = (value, defaultValue) => value == null ? defaultValue : value === true || value === 'true';
  return {
    tasks,
    tabs,
    deletedTasks,
    settings: {
      soundEnabled: bool(legacy.karkas_sound_enabled, true),
      fireEnabled: bool(legacy.karkas_fire_enabled, true),
      lang: legacy.todo_app_lang === 'en' ? 'en' : 'uk',
      aiIconVariant: typeof legacy.karkas_ai_icon_variant === 'string' ? legacy.karkas_ai_icon_variant : 'quantum',
    },
  };
}

function normalizeLegacySnapshot(legacy) {
  if (!isPlainObject(legacy)) throw new DesktopStorageError('INVALID_LEGACY_DATA', 'Legacy snapshot must be an object');
  const activeOwnerValue = legacy.karkas_workspace_owner ?? legacy.activeOwner ?? null;
  const activeOwner = activeOwnerValue == null || activeOwnerValue === '' ? null : activeOwnerValue;
  assertOwner(activeOwner);
  const store = { activeOwner, accounts: {} };

  for (const [key, raw] of Object.entries(legacy)) {
    if (!key.startsWith('karkas_workspace:') || key.endsWith(':before-restore')) continue;
    const suffix = key.slice('karkas_workspace:'.length);
    const owner = suffix === 'guest' ? null : suffix;
    assertOwner(owner);
    const cached = parseLegacyJson(raw, null);
    if (!isPlainObject(cached) || !cached.workspace) continue;
    const account = { workspace: cached.workspace };
    if (cached.base !== undefined) account.base = cached.base;
    if (cached.lastSyncTime !== undefined) account.lastSyncTime = cached.lastSyncTime;
    assertAccount(account);
    store.accounts[ownerMapKey(owner)] = account;
  }

  const directWorkspace = normalizeLegacyWorkspace(legacy);
  const directHasData = directWorkspace.tasks.length > 0 || directWorkspace.tabs.length > 0 || directWorkspace.deletedTasks.length > 0;
  const activeKey = ownerMapKey(activeOwner);
  if (!store.accounts[activeKey] && (directHasData || Object.keys(store.accounts).length === 0)) {
    const lastSync = legacy.karkas_last_sync_time == null ? null : Number(legacy.karkas_last_sync_time);
    store.accounts[activeKey] = {
      workspace: directWorkspace,
      ...(Number.isFinite(lastSync) && lastSync >= 0 ? { lastSyncTime: lastSync } : {}),
    };
  }
  const activeLastSync = legacy.karkas_last_sync_time == null ? null : Number(legacy.karkas_last_sync_time);
  if (store.accounts[activeKey] && Number.isFinite(activeLastSync) && activeLastSync >= 0) {
    store.accounts[activeKey].lastSyncTime = activeLastSync;
  }

  for (const [key, raw] of Object.entries(legacy)) {
    if (!key.startsWith('karkas_workspace:') || !key.endsWith(':before-restore')) continue;
    const suffix = key.slice('karkas_workspace:'.length, -':before-restore'.length);
    const owner = suffix === 'guest' ? null : suffix;
    const recovery = parseLegacyJson(raw, null);
    const account = store.accounts[ownerMapKey(owner)];
    if (account && recovery) {
      assertWorkspace(recovery);
      account.recovery = recovery;
    }
  }
  assertAccountStore(store);
  return store;
}

function createDesktopStorage({ userDataPath }) {
  if (typeof userDataPath !== 'string' || userDataPath.trim() === '') {
    throw new TypeError('userDataPath must be a non-empty string');
  }
  const root = path.resolve(userDataPath);
  const paths = {
    workspace: path.join(root, WORKSPACE_FILE),
    preferences: path.join(root, PREFERENCES_FILE),
  };
  const queues = new Map();

  const serializeEnvelope = (kind, data, maxBytes) => {
    const envelope = { schemaVersion: SCHEMA_VERSION, kind, updatedAt: Date.now(), data };
    const text = JSON.stringify(envelope);
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new DesktopStorageError('DATA_TOO_LARGE', `${kind} exceeds the ${maxBytes}-byte storage limit`);
    }
    return text;
  };

  const atomicWrite = async (filePath, text) => {
    await fs.mkdir(root, { recursive: true });
    const suffix = `${process.pid}-${Date.now()}-${randomBytes(6).toString('hex')}`;
    const tempPath = path.join(root, `.${path.basename(filePath)}.${suffix}.tmp`);
    let handle;
    try {
      handle = await fs.open(tempPath, 'wx', 0o600);
      await handle.writeFile(text, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(tempPath, filePath);
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(tempPath).catch(() => {});
      throw new DesktopStorageError('WRITE_FAILED', `Could not save ${path.basename(filePath)}`, error);
    }
  };

  const enqueue = (filePath, operation) => {
    const previous = queues.get(filePath) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    queues.set(filePath, current);
    return current.finally(() => {
      if (queues.get(filePath) === current) queues.delete(filePath);
    });
  };

  const readEnvelope = async (filePath, kind, maxBytes, validate) => {
    let stats;
    try {
      stats = await fs.stat(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new DesktopStorageError('READ_FAILED', `Could not inspect ${path.basename(filePath)}`, error);
    }
    if (!stats.isFile()) throw new DesktopStorageError('CORRUPT_DATA', `${path.basename(filePath)} is not a file`);
    if (stats.size > maxBytes + ENVELOPE_ALLOWANCE_BYTES) {
      throw new DesktopStorageError('DATA_TOO_LARGE', `${path.basename(filePath)} exceeds its storage limit`);
    }
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
      const compatibleWorkspaceV1 = kind === 'workspace' && parsed?.schemaVersion === 1;
      if (!isPlainObject(parsed) || (parsed.schemaVersion !== SCHEMA_VERSION && !compatibleWorkspaceV1) || parsed.kind !== kind || !('data' in parsed)) {
        throw new DesktopStorageError('UNSUPPORTED_SCHEMA', `Unsupported or invalid ${kind} storage format`);
      }
      validate(parsed.data);
      return parsed.data;
    } catch (error) {
      if (error instanceof DesktopStorageError) throw error;
      throw new DesktopStorageError('CORRUPT_DATA', `Could not read ${path.basename(filePath)}`, error);
    }
  };

  const save = (filePath, kind, data, maxBytes, validate) => enqueue(filePath, async () => {
    validate(data);
    await atomicWrite(filePath, serializeEnvelope(kind, data, maxBytes));
    return data;
  });

  const assertWorkspaceFileData = (data) => {
    if (isPlainObject(data) && isPlainObject(data.accounts)) assertAccountStore(data);
    else assertWorkspace(data);
  };
  const readAccountStore = async () => {
    const data = await readEnvelope(paths.workspace, 'workspace', MAX_WORKSPACE_BYTES, assertWorkspaceFileData);
    if (data === null) return null;
    // Compatibility with schema v1 from the first desktop-storage implementation.
    if (isPlainObject(data) && Array.isArray(data.tasks)) {
      return { activeOwner: null, accounts: { [ownerMapKey(null)]: { workspace: data } } };
    }
    return data;
  };
  const writeAccountStore = async (store) => {
    assertAccountStore(store);
    await atomicWrite(paths.workspace, serializeEnvelope('workspace', store, MAX_WORKSPACE_BYTES));
    return store;
  };
  const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const currentAccount = (store) => store?.accounts[ownerMapKey(store.activeOwner)] || null;
  const importLegacySnapshotUnlocked = async (legacy) => {
    try {
      await fs.stat(paths.workspace);
      const store = await readAccountStore();
      return { imported: false, store };
    } catch (error) {
      if (error instanceof DesktopStorageError || error.code !== 'ENOENT') throw error;
    }
    const store = normalizeLegacySnapshot(legacy);
    await writeAccountStore(store);
    const verified = await readAccountStore();
    return { imported: true, store: verified };
  };

  return Object.freeze({
    paths: Object.freeze({ ...paths }),
    loadAccount: (owner) => enqueue(paths.workspace, async () => {
      const store = await readAccountStore();
      return store?.accounts[ownerMapKey(owner)] || null;
    }),
    saveAccount: (owner, account) => enqueue(paths.workspace, async () => {
      assertOwner(owner);
      assertAccount(account);
      const store = await readAccountStore() || emptyAccountStore();
      const key = ownerMapKey(owner);
      // Renderer snapshots intentionally omit metadata they did not change.
      // Preserve recovery/last-sync fields instead of erasing them on each edit.
      store.accounts[key] = { ...(store.accounts[key] || {}), ...account };
      await writeAccountStore(store);
      return store.accounts[key];
    }),
    getActiveOwner: () => enqueue(paths.workspace, async () => (await readAccountStore())?.activeOwner ?? null),
    setActiveOwner: (owner) => enqueue(paths.workspace, async () => {
      assertOwner(owner);
      const store = await readAccountStore() || emptyAccountStore();
      store.activeOwner = owner;
      await writeAccountStore(store);
      return owner;
    }),
    createRecoveryPoint: (owner, recoveryWorkspace) => enqueue(paths.workspace, async () => {
      const store = await readAccountStore() || emptyAccountStore();
      const account = store.accounts[ownerMapKey(owner)];
      if (!account) throw new DesktopStorageError('ACCOUNT_NOT_FOUND', 'Cannot create a recovery point for a missing account');
      const recovery = recoveryWorkspace ?? account.workspace;
      assertWorkspace(recovery);
      account.recovery = recovery;
      await writeAccountStore(store);
      return recovery;
    }),
    stageSync: (owner, snapshot) => enqueue(paths.workspace, async () => {
      assertOwner(owner);
      if (owner === null) throw new DesktopStorageError('INVALID_OWNER', 'Guest workspace cannot be queued for cloud sync');
      if (!isPlainObject(snapshot)) throw new DesktopStorageError('INVALID_DATA', 'Sync snapshot must be an object');
      assertWorkspace(snapshot.workspace);
      if (snapshot.base !== undefined && snapshot.base !== null) assertWorkspace(snapshot.base);
      if (snapshot.operations !== undefined) assertSyncOperations(snapshot.operations, 'Sync operations');
      const store = await readAccountStore() || emptyAccountStore();
      const key = ownerMapKey(owner);
      const account = store.accounts[key] || { workspace: snapshot.workspace };
      if (account.pendingSync && sameJson(account.pendingSync.workspace, snapshot.workspace) &&
          sameJson(account.pendingSync.base ?? null, snapshot.base ?? null)) return account.pendingSync;
      if (!account.pendingSync && account.inFlightSync && sameJson(account.inFlightSync.workspace, snapshot.workspace) &&
          sameJson(account.inFlightSync.base ?? null, snapshot.base ?? null)) return account.inFlightSync;
      const clientId = account.syncClientId || randomBytes(16).toString('hex');
      const sequence = (account.nextSyncSequence || 0) + 1;
      const now = Date.now();
      const pendingSync = {
        mutationId: `${clientId}:${sequence}`,
        clientId,
        sequence,
        createdAt: now,
        attempts: 0,
        nextAttemptAt: now,
        workspace: snapshot.workspace,
        base: snapshot.base ?? null,
        ...(snapshot.operations ? { operations: snapshot.operations } : {}),
      };
      store.accounts[key] = {
        ...account, workspace: snapshot.workspace, base: snapshot.base ?? null,
        syncClientId: clientId, nextSyncSequence: sequence, pendingSync,
      };
      await writeAccountStore(store);
      return pendingSync;
    }),
    claimSync: (owner, bypassBackoff = false) => enqueue(paths.workspace, async () => {
      const store = await readAccountStore() || emptyAccountStore();
      const account = store.accounts[ownerMapKey(owner)];
      if (!account) return null;
      const candidate = account.inFlightSync || account.pendingSync;
      if (!candidate || (!bypassBackoff && candidate.nextAttemptAt > Date.now())) return null;
      if (!account.inFlightSync) {
        account.inFlightSync = candidate;
        delete account.pendingSync;
        await writeAccountStore(store);
      }
      return account.inFlightSync;
    }),
    markSyncFailed: (owner, mutationId, message) => enqueue(paths.workspace, async () => {
      const store = await readAccountStore() || emptyAccountStore();
      const account = store.accounts[ownerMapKey(owner)];
      if (!account?.inFlightSync || account.inFlightSync.mutationId !== mutationId) return account?.inFlightSync || null;
      const attempts = account.inFlightSync.attempts + 1;
      const delay = Math.min(5 * 60 * 1000, 1000 * (2 ** Math.min(attempts - 1, 12)));
      account.inFlightSync = {
        ...account.inFlightSync,
        attempts,
        nextAttemptAt: Date.now() + delay,
        lastError: String(message || 'Sync failed').slice(0, 500),
      };
      await writeAccountStore(store);
      return account.inFlightSync;
    }),
    acknowledgeSync: (owner, mutationId, acknowledged) => enqueue(paths.workspace, async () => {
      const store = await readAccountStore() || emptyAccountStore();
      const account = store.accounts[ownerMapKey(owner)];
      if (!account) throw new DesktopStorageError('ACCOUNT_NOT_FOUND', 'Cannot acknowledge a missing account');
      if (!account.inFlightSync || account.inFlightSync.mutationId !== mutationId) {
        return { acknowledged: false, pending: account.pendingSync || account.inFlightSync || null };
      }
      if (!isPlainObject(acknowledged) || !Number.isFinite(acknowledged.lastSyncTime)) {
        throw new DesktopStorageError('INVALID_DATA', 'Sync acknowledgement is invalid');
      }
      assertWorkspace(acknowledged.base);
      account.base = acknowledged.base;
      account.lastSyncTime = acknowledged.lastSyncTime;
      delete account.inFlightSync;
      if (account.pendingSync) account.pendingSync.base = acknowledged.base;
      await writeAccountStore(store);
      return { acknowledged: true, pending: account.pendingSync || null };
    }),
    replaceWithCloud: (owner, cloudWorkspace, lastSyncTime) => enqueue(paths.workspace, async () => {
      assertOwner(owner);
      if (owner === null) throw new DesktopStorageError('INVALID_OWNER', 'Guest workspace cannot be restored from cloud');
      assertWorkspace(cloudWorkspace);
      if (!Number.isFinite(lastSyncTime)) {
        throw new DesktopStorageError('INVALID_DATA', 'Cloud restore timestamp is invalid');
      }
      const store = await readAccountStore() || emptyAccountStore();
      const key = ownerMapKey(owner);
      const account = store.accounts[key] || {};
      store.accounts[key] = {
        ...account,
        workspace: cloudWorkspace,
        base: cloudWorkspace,
        lastSyncTime,
      };
      delete store.accounts[key].pendingSync;
      delete store.accounts[key].inFlightSync;
      await writeAccountStore(store);
      return store.accounts[key];
    }),
    importLegacySnapshot: (legacy) => enqueue(paths.workspace, () => importLegacySnapshotUnlocked(legacy)),
    // Compatibility facade: workspace means the currently active account.
    loadWorkspace: () => enqueue(paths.workspace, async () => currentAccount(await readAccountStore())?.workspace || null),
    saveWorkspace: (workspace) => enqueue(paths.workspace, async () => {
      assertWorkspace(workspace);
      const store = await readAccountStore() || emptyAccountStore();
      const key = ownerMapKey(store.activeOwner);
      store.accounts[key] = { ...(store.accounts[key] || {}), workspace };
      await writeAccountStore(store);
      return workspace;
    }),
    importLegacyWorkspace: (legacy) => enqueue(paths.workspace, async () => {
      const result = await importLegacySnapshotUnlocked(legacy);
      return { imported: result.imported, workspace: currentAccount(result.store)?.workspace || null };
    }),
    loadPreferences: () => enqueue(paths.preferences, () => readEnvelope(paths.preferences, 'preferences', MAX_PREFERENCES_BYTES, assertPreferences)),
    savePreferences: (preferences) => save(paths.preferences, 'preferences', preferences, MAX_PREFERENCES_BYTES, assertPreferences),
    updatePreferences: (changes) => enqueue(paths.preferences, async () => {
      if (!isPlainObject(changes)) throw new DesktopStorageError('INVALID_DATA', 'Preference changes must be an object');
      const current = await readEnvelope(paths.preferences, 'preferences', MAX_PREFERENCES_BYTES, assertPreferences) || {};
      const next = { ...current, ...changes };
      assertPreferences(next);
      await atomicWrite(paths.preferences, serializeEnvelope('preferences', next, MAX_PREFERENCES_BYTES));
      return next;
    }),
  });
}

module.exports = {
  createDesktopStorage,
  normalizeLegacyWorkspace,
  normalizeLegacySnapshot,
  ownerMapKey,
  DesktopStorageError,
  SCHEMA_VERSION,
  MAX_WORKSPACE_BYTES,
  MAX_PREFERENCES_BYTES,
};
