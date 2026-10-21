import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  signInWithRedirect,
  signOut,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  runTransaction,
  getDocFromServer,
  onSnapshot,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { PSTask, TaskTab, DeletedTask, type GrowthSkill, type SkillMeasurement, type PracticeSession } from '../types';
import { GROWTH_COLLECTIONS } from '../utils/growthSync';
import { emptyGrowthShadowWrites, type GrowthShadowStoredDocuments } from '../utils/growthCloudShadow';
import { serializeTaskForCloud } from '../utils/cloudTaskSerialization';
import { parseWorkspace } from '../utils/workspaceValidation';
import { assertCloudPayloadWithinLimit, isSyncMutationApplied, mergeWorkspace, recordSyncMutation, sameWorkspace, type SyncMutationIdentity, type WorkspaceState } from '../utils/syncState';
import {
  buildCloudShadowPlan,
  encodeCloudEntityDocumentId,
  materializeCloudShadow,
  pageCloudShadowPlan,
  parseCloudShadowManifest,
  type CloudShadowManifest,
  type CloudShadowPlan,
  type CloudShadowStoredSettings,
  type CloudShadowStoredTab,
  type CloudShadowStoredTask,
} from '../utils/cloudShadow';

// Initialize Firebase App instance safely
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Authentication
export const auth = getAuth(app);

// Initialize Google Auth Provider
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

// Initialize Cloud Firestore using the configured database ID
export const db =
  firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
    ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
    : getFirestore(app);

export interface UserCloudState {
  userId: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  tasks: PSTask[];
  tabs: TaskTab[];
  deletedTasks: DeletedTask[];
  skills?: GrowthSkill[];
  measurements?: SkillMeasurement[];
  practiceSessions?: PracticeSession[];
  settings: {
    soundEnabled: boolean;
    fireEnabled: boolean;
    lang: string;
    aiIconVariant: string;
  };
  updatedAt: number;
  revision?: number;
  syncClients?: Record<string, number>;
  shadowSchemaVersion?: 2 | null;
  shadowRevision?: number | null;
  shadowStatus?: 'ready' | 'migrating' | 'deferred';
}

function parseCloudState(value: unknown, ownerId: string): UserCloudState {
  try {
    const state = parseWorkspace(value) as UserCloudState;
    if (state.userId !== ownerId || !Number.isFinite(state.updatedAt) || state.updatedAt < 0 ||
        (state.revision !== undefined && (!Number.isSafeInteger(state.revision) || state.revision < 0))) {
      throw new Error('Cloud workspace owner or revision is invalid');
    }
    return state;
  } catch (error) {
    // Keep the original cloud document intact and retain an account-scoped local
    // copy. No sanitized partial document can overwrite the source on next sync.
    if (typeof localStorage !== 'undefined') {
      const raw = JSON.stringify(value);
      const prefix = `karkas_cloud_recovery:${encodeURIComponent(ownerId)}:`;
      const previous = localStorage.getItem(`${prefix}latest`);
      if (previous !== raw) {
        localStorage.setItem(`${prefix}${Date.now()}`, raw);
        localStorage.setItem(`${prefix}latest`, raw);
      }
    }
    throw error;
  }
}

function emptyWorkspace(settings: WorkspaceState['settings']): WorkspaceState & { revision: number } {
  return { tasks: [], tabs: [], deletedTasks: [], settings, revision: 0 };
}

function writeCloudShadow(
  transaction: Parameters<Parameters<typeof runTransaction>[1]>[0],
  userId: string,
  plan: CloudShadowPlan,
  updatedAt: number,
  mutation?: SyncMutationIdentity,
  writeManifest = true,
) {
  const mutationMetadata = mutation ? { clientId: mutation.clientId, sequence: mutation.sequence } : null;
  for (const write of plan.taskWrites) {
    transaction.set(doc(db, 'users', userId, 'tasks', write.documentId), sanitizeForFirestore({
      id: write.id,
      lifecycle: write.lifecycle,
      ...(write.value ? { value: write.value } : {}),
      revision: plan.manifest.revision,
      updatedAt,
      ...(mutationMetadata ? { lastMutation: mutationMetadata } : {}),
    }));
  }
  for (const write of plan.tabWrites) {
    transaction.set(doc(db, 'users', userId, 'tabs', write.documentId), sanitizeForFirestore({
      id: write.id,
      lifecycle: write.lifecycle,
      ...(write.value ? { value: write.value } : {}),
      revision: plan.manifest.revision,
      updatedAt,
      ...(mutationMetadata ? { lastMutation: mutationMetadata } : {}),
    }));
  }
  for (const collection of GROWTH_COLLECTIONS) {
    for (const write of plan.growthWrites[collection]) {
      transaction.set(doc(db, 'users', userId, collection, write.documentId), sanitizeForFirestore({
        id: write.id,
        lifecycle: write.lifecycle,
        ...(write.value ? { value: write.value } : {}),
        revision: plan.manifest.revision,
        updatedAt,
        ...(mutationMetadata ? { lastMutation: mutationMetadata } : {}),
      }));
    }
  }
  if (plan.settings) {
    transaction.set(doc(db, 'users', userId, 'workspace', 'settings'), sanitizeForFirestore({
      value: plan.settings,
      revision: plan.manifest.revision,
      updatedAt,
      ...(mutationMetadata ? { lastMutation: mutationMetadata } : {}),
    }));
  }
  if (writeManifest) {
    transaction.set(doc(db, 'users', userId, 'workspace', 'manifest'), sanitizeForFirestore({
      ...plan.manifest,
      updatedAt,
    }));
  }
}

export async function advanceUserCloudShadowMigration(userId: string, maxBatches = 4): Promise<boolean> {
  if (!Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 25) {
    throw new Error('Cloud shadow migration batch limit is invalid');
  }
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid !== userId) throw new Error('User is not authorized to migrate cloud data');

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const complete = await runTransaction(db, async (transaction) => {
      const rootRef = doc(db, 'users', userId);
      const manifestRef = doc(db, 'users', userId, 'workspace', 'manifest');
      const checkpointRef = doc(db, 'users', userId, 'workspace', 'migration');
      const rootSnapshot = await transaction.get(rootRef);
      if (!rootSnapshot.exists()) return true;
      const root = parseCloudState(rootSnapshot.data(), userId);
      const revision = Number(root.revision) || 0;
      if (revision < 1) throw new Error('Cloud workspace revision is invalid');
      const manifestSnapshot = await transaction.get(manifestRef);
      const checkpointSnapshot = await transaction.get(checkpointRef);
      const previousManifest = manifestSnapshot.exists() ? manifestSnapshot.data() as CloudShadowManifest : null;
      if (root.shadowStatus === 'ready' && root.shadowSchemaVersion === 2 &&
          root.shadowRevision === revision && previousManifest?.revision === revision &&
          GROWTH_COLLECTIONS.every(collection => root[collection] === undefined || previousManifest?.[collection] !== undefined)) return true;

      const plan = buildCloudShadowPlan(previousManifest, root, root, revision, {
        maxWrites: Number.MAX_SAFE_INTEGER,
      });
      const checkpoint = checkpointSnapshot.exists() ? checkpointSnapshot.data() : null;
      const planEntryCount = plan.taskWrites.length + plan.tabWrites.length +
        GROWTH_COLLECTIONS.reduce((count, collection) => count + plan.growthWrites[collection].length, 0) + (plan.settings ? 1 : 0);
      const checkpointCursor = checkpoint?.targetRevision === revision && Number.isSafeInteger(checkpoint?.cursor) &&
        checkpoint.cursor >= 0 && checkpoint.cursor <= planEntryCount ? checkpoint.cursor : 0;
      const cursor = checkpointCursor;
      const page = pageCloudShadowPlan(plan, cursor, 400);
      writeCloudShadow(transaction, userId, {
        ...plan,
        taskWrites: page.taskWrites,
        tabWrites: page.tabWrites,
        growthWrites: page.growthWrites,
        settings: page.settings,
      }, Date.now(), undefined, false);

      if (page.complete) {
        transaction.set(manifestRef, sanitizeForFirestore({ ...plan.manifest, updatedAt: Date.now() }));
        transaction.set(rootRef, {
          userId,
          shadowStatus: 'ready',
          shadowSchemaVersion: 2,
          shadowRevision: revision,
        }, { merge: true });
        transaction.delete(checkpointRef);
        return true;
      }
      transaction.set(checkpointRef, {
        targetRevision: revision,
        cursor: page.nextCursor,
        updatedAt: Date.now(),
      });
      transaction.set(rootRef, {
        userId,
        shadowStatus: 'migrating',
        shadowSchemaVersion: null,
        shadowRevision: null,
      }, { merge: true });
      return false;
    });
    if (complete) return true;
  }
  return false;
}

// Sign in with Google Popup
export async function loginWithGoogle(): Promise<User> {
  if (window.karkasDesktop?.isDesktop) {
    const desktopResult = await window.karkasDesktop.auth.loginWithGoogle();
    if ('error' in desktopResult) throw new Error(desktopResult.error.message);
    const result = desktopResult.value;
    if (!result.success) throw new Error(result.error || 'Не вдалося відкрити вхід у браузері.');
    const credential = GoogleAuthProvider.credential(result.idToken, result.accessToken);
    return (await signInWithCredential(auth, credential)).user;
  }
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error: any) {
    if (error?.code === 'auth/popup-blocked') {
      console.warn('Popup blocked, attempting redirect fallback...');
      try {
        await signInWithRedirect(auth, googleProvider);
      } catch (redirectErr) {
        console.error('Redirect sign-in error:', redirectErr);
      }
    }
    throw error;
  }
}

// Sign out
export async function logoutUser(): Promise<void> {
  await signOut(auth);
}

// Recursively cleans objects and arrays to prevent Firestore undefined errors
export function sanitizeForFirestore<T>(data: T): T {
  if (data === null || data === undefined) {
    return null as unknown as T;
  }
  if (Array.isArray(data)) {
    return data
      .filter((item) => item !== undefined)
      .map((item) => sanitizeForFirestore(item)) as unknown as T;
  }
  if (typeof data === 'object') {
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        sanitized[key] = sanitizeForFirestore(value);
      }
    }
    return sanitized as T;
  }
  return data;
}

// Save all user tasks, tabs, deleted history and settings to Firestore
export async function saveUserCloudData(
  userId: string,
  data: WorkspaceState,
  base: WorkspaceState | null = null,
  mutation?: SyncMutationIdentity,
): Promise<UserCloudState> {
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid !== userId) {
    throw new Error('User is not authorized to save this cloud data');
  }
  parseWorkspace(data);
  if (base) parseWorkspace(base);

  const userDocRef = doc(db, 'users', userId);
  const saved = await runTransaction(db, async (transaction) => {
  const snapshot = await transaction.get(userDocRef);
  const existing = snapshot.exists() ? parseCloudState(snapshot.data(), userId) : null;
  let syncClientRef: ReturnType<typeof doc> | null = null;
  if (mutation) {
    if (!/^[a-zA-Z0-9_-]{8,80}$/.test(mutation.clientId) || !Number.isSafeInteger(mutation.sequence) || mutation.sequence < 1) {
      throw new Error('Invalid sync mutation identity');
    }
    syncClientRef = doc(db, 'users', userId, 'syncClients', mutation.clientId);
    const syncClientSnapshot = await transaction.get(syncClientRef);
    const durableSequence = syncClientSnapshot.exists() ? syncClientSnapshot.data().lastSequence : null;
    const durableApplied = Number.isSafeInteger(durableSequence) && durableSequence >= mutation.sequence;
    const legacyApplied = isSyncMutationApplied(existing?.syncClients, mutation);
    if (durableApplied || legacyApplied) {
      if (!existing) throw new Error('Sync watermark exists without a cloud workspace');
      if (!durableApplied) {
        transaction.set(syncClientRef, {
          clientId: mutation.clientId,
          lastSequence: mutation.sequence,
          updatedAt: Date.now(),
        }, { merge: true });
      }
      return existing;
    }
  }
  const shadowManifestRef = doc(db, 'users', userId, 'workspace', 'manifest');
  const shadowManifestSnapshot = await transaction.get(shadowManifestRef);
  const previousShadowManifest = shadowManifestSnapshot.exists()
    ? shadowManifestSnapshot.data() as CloudShadowManifest
    : null;
  const merged = snapshot.exists()
    ? mergeWorkspace(base, data, existing!)
    : data;
  parseWorkspace(merged);
  const syncClients = mutation
    ? recordSyncMutation(existing?.syncClients, mutation)
    : { ...(existing?.syncClients || {}) };
  const nextRevision = (Number(snapshot.data()?.revision) || 0) + 1;
  const rawPayload = {
    userId,
    email: currentUser.email ?? null,
    displayName: currentUser.displayName ?? null,
    photoURL: currentUser.photoURL ?? null,
    tasks: (merged.tasks || []).map((task) => serializeTaskForCloud(task)),
    tabs: (merged.tabs || []).map((tb) => {
      const tabObj: Record<string, any> = {
        id: tb.id,
        name: tb.name,
      };
      if (tb.color) tabObj.color = tb.color;
      return tabObj;
    }),
    deletedTasks: (merged.deletedTasks || []).map((task) => serializeTaskForCloud(task)),
    skills: merged.skills ?? [],
    measurements: merged.measurements ?? [],
    practiceSessions: merged.practiceSessions ?? [],
    settings: {
      soundEnabled: Boolean(merged.settings?.soundEnabled),
      fireEnabled: Boolean(merged.settings?.fireEnabled),
      lang: merged.settings?.lang || 'uk',
      aiIconVariant: merged.settings?.aiIconVariant || 'quantum',
    },
    updatedAt: Date.now(),
    revision: nextRevision,
    syncClients,
  };

  const cleanPayload = sanitizeForFirestore(rawPayload) as UserCloudState;
  parseWorkspace(cleanPayload);
  let shadowPlan: CloudShadowPlan | null = null;
  try {
    // Plan from the exact normalized payload written to v1, so shadow values
    // can be verified byte-for-byte before the eventual schema cutover.
    shadowPlan = buildCloudShadowPlan(
      previousShadowManifest,
      existing ?? emptyWorkspace(cleanPayload.settings),
      cleanPayload,
      nextRevision,
    );
  } catch (error) {
    // Legacy v1 remains authoritative until the shadow is verified and cut over.
    // A very large first migration is deferred instead of blocking user sync.
    console.warn('Cloud schema v2 shadow write deferred:', error instanceof Error ? error.message : 'invalid shadow plan');
  }
  cleanPayload.shadowStatus = shadowPlan ? 'ready' : 'deferred';
  if (shadowPlan) {
    cleanPayload.shadowSchemaVersion = 2;
    cleanPayload.shadowRevision = nextRevision;
  } else {
    // Never leave a stale revision looking eligible for schema-v2 reads.
    cleanPayload.shadowSchemaVersion = null;
    cleanPayload.shadowRevision = null;
  }
  // Firestore documents have a hard 1 MiB limit. Leave headroom for field names
  // and wire-format overhead so users get a clear, recoverable sync error first.
  assertCloudPayloadWithinLimit(cleanPayload);
  if (shadowPlan) writeCloudShadow(transaction, userId, shadowPlan, cleanPayload.updatedAt, mutation);
  if (mutation && syncClientRef) {
    transaction.set(syncClientRef, {
      clientId: mutation.clientId,
      lastSequence: mutation.sequence,
      updatedAt: cleanPayload.updatedAt,
    });
  }
  transaction.set(userDocRef, cleanPayload, { merge: true });
  return cleanPayload;
  });
  if (saved.shadowStatus === 'deferred') {
    try {
      await advanceUserCloudShadowMigration(userId);
    } catch (error) {
      console.warn('Cloud schema v2 background migration paused:', error instanceof Error ? error.message : 'migration failed');
    }
  }
  return saved;
}

// Load user data from Firestore
export async function fetchUserCloudData(userId: string): Promise<UserCloudState | null> {
  const userDocRef = doc(db, 'users', userId);
  const snapshot = await getDocFromServer(userDocRef);
  if (snapshot.exists()) {
    return parseCloudState(snapshot.data(), userId);
  }
  return null;
}

async function getServerDocumentsInBatches(references: ReturnType<typeof doc>[]) {
  const snapshots = [];
  for (let index = 0; index < references.length; index += 50) {
    snapshots.push(...await Promise.all(references.slice(index, index + 50).map((reference) => getDocFromServer(reference))));
  }
  return snapshots;
}

export async function fetchUserCloudShadowData(userId: string, expectedRevision: number): Promise<WorkspaceState> {
  const manifestSnapshot = await getDocFromServer(doc(db, 'users', userId, 'workspace', 'manifest'));
  if (!manifestSnapshot.exists()) throw new Error('Cloud shadow manifest is missing');
  const manifest = parseCloudShadowManifest(manifestSnapshot.data());
  if (manifest.revision !== expectedRevision) throw new Error('Cloud shadow manifest revision is stale');

  const [taskSnapshots, tabSnapshots, settingsSnapshot, growthSnapshots] = await Promise.all([
    getServerDocumentsInBatches(manifest.tasks.map((entry) =>
      doc(db, 'users', userId, 'tasks', encodeCloudEntityDocumentId(entry.id)))),
    getServerDocumentsInBatches(manifest.tabs.map((entry) =>
      doc(db, 'users', userId, 'tabs', encodeCloudEntityDocumentId(entry.id)))),
    getDocFromServer(doc(db, 'users', userId, 'workspace', 'settings')),
    Promise.all(GROWTH_COLLECTIONS.map(collection => getServerDocumentsInBatches((manifest[collection] ?? []).map(entry =>
      doc(db, 'users', userId, collection, encodeCloudEntityDocumentId(entry.id)))))),
  ]);
  if (!settingsSnapshot.exists()) throw new Error('Cloud shadow settings are missing');
  const taskDocuments = taskSnapshots.map((snapshot) => ({
    ...(snapshot.exists() ? snapshot.data() : {}),
    documentId: snapshot.id,
  })) as CloudShadowStoredTask[];
  const tabDocuments = tabSnapshots.map((snapshot) => ({
    ...(snapshot.exists() ? snapshot.data() : {}),
    documentId: snapshot.id,
  })) as CloudShadowStoredTab[];
  const growthDocuments: GrowthShadowStoredDocuments = emptyGrowthShadowWrites();
  GROWTH_COLLECTIONS.forEach((collection, index) => {
    growthDocuments[collection] = growthSnapshots[index].map(snapshot => ({
      ...(snapshot.exists() ? snapshot.data() : {}), documentId: snapshot.id,
    })) as GrowthShadowStoredDocuments[typeof collection];
  });
  const settingsDocument = settingsSnapshot.data() as CloudShadowStoredSettings;
  return parseWorkspace(materializeCloudShadow(manifest, taskDocuments, tabDocuments, settingsDocument, growthDocuments));
}

export async function verifyUserCloudShadowData(userId: string, legacy: UserCloudState): Promise<boolean> {
  if (legacy.shadowStatus !== 'ready' || legacy.shadowSchemaVersion !== 2 ||
      legacy.shadowRevision !== legacy.revision) return false;
  try {
    return sameWorkspace(await fetchUserCloudShadowData(userId, legacy.revision || 0), legacy);
  } catch (error) {
    console.warn('Cloud schema v2 verification failed:', error instanceof Error ? error.message : 'invalid shadow data');
    return false;
  }
}

export async function repairUserCloudShadowData(userId: string, expectedRevision: number): Promise<boolean> {
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid !== userId) throw new Error('User is not authorized to repair cloud data');
  const invalidated = await runTransaction(db, async (transaction) => {
    const rootRef = doc(db, 'users', userId);
    const snapshot = await transaction.get(rootRef);
    if (!snapshot.exists() || (Number(snapshot.data().revision) || 0) !== expectedRevision) return false;
    transaction.set(rootRef, {
      userId,
      shadowStatus: 'deferred',
      shadowSchemaVersion: null,
      shadowRevision: null,
    }, { merge: true });
    return true;
  });
  return invalidated ? advanceUserCloudShadowMigration(userId) : false;
}

// Real-time listener for user data
export function subscribeToUserCloudData(
  userId: string,
  onData: (data: UserCloudState) => void,
  onError?: (err: Error) => void
) {
  const userDocRef = doc(db, 'users', userId);
  return onSnapshot(
    userDocRef,
    { includeMetadataChanges: true },
    (snapshot) => {
      if (snapshot.exists() && !snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) {
        try { onData(parseCloudState(snapshot.data(), userId)); }
        catch (error) { onError?.(error instanceof Error ? error : new Error('Invalid cloud workspace')); }
      }
    },
    (error) => {
      console.error('Error listening to user cloud data:', error);
      if (onError) onError(error);
    }
  );
}
