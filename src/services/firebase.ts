import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  signInWithRedirect,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  runTransaction,
  getDoc,
  getDocFromServer,
  onSnapshot,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { PSTask, TaskTab, DeletedTask } from '../types';
import { mergeWorkspace, type WorkspaceState } from '../utils/syncState';

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

// Validate connection to Firestore on boot gracefully
async function testFirestoreConnection() {
  try {
    await getDoc(doc(db, 'test', 'connection'));
  } catch (error) {
    // Fail silently or log mild debug info if offline
    console.debug('Firestore offline mode active or document inaccessible.');
  }
}
testFirestoreConnection();

export interface UserCloudState {
  userId: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  tasks: PSTask[];
  tabs: TaskTab[];
  deletedTasks: DeletedTask[];
  settings: {
    soundEnabled: boolean;
    fireEnabled: boolean;
    lang: string;
    aiIconVariant: string;
  };
  updatedAt: number;
  revision?: number;
}

// Sign in with Google Popup
export async function loginWithGoogle(): Promise<User> {
  if (window.electronAPI?.isElectron) {
    if (!window.electronAPI.loginWithGoogle) throw new Error('Перезапустіть застосунок, щоб увімкнути вхід у браузері.');
    const result = await window.electronAPI.loginWithGoogle();
    if (!result.success) throw new Error(result.error || 'Не вдалося відкрити вхід у браузері.');
    const credential = GoogleAuthProvider.credential(result.idToken, result.accessToken);
    return (await signInWithCredential(auth, credential)).user;
  }
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error: any) {
    if (
      error?.code === 'auth/popup-blocked' ||
      error?.code === 'auth/popup-closed-by-user' ||
      error?.code === 'auth/cancelled-popup-request'
    ) {
      console.warn('Popup blocked or closed, attempting redirect fallback...');
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
): Promise<UserCloudState> {
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid !== userId) {
    throw new Error('User is not authorized to save this cloud data');
  }

  const userDocRef = doc(db, 'users', userId);
  return runTransaction(db, async (transaction) => {
  const snapshot = await transaction.get(userDocRef);
  const merged = snapshot.exists()
    ? mergeWorkspace(base, data, snapshot.data() as UserCloudState)
    : data;
  const rawPayload = {
    userId,
    email: currentUser.email ?? null,
    displayName: currentUser.displayName ?? null,
    photoURL: currentUser.photoURL ?? null,
    tasks: (merged.tasks || []).map((t) => {
      const taskObj: Record<string, any> = {
        id: t.id,
        title: t.title,
        phase: t.phase,
        priority: t.priority,
        steps: t.steps,
        currentStep: t.currentStep,
        done: Boolean(t.done),
        pinned: Boolean(t.pinned),
        createdAt: t.createdAt || Date.now(),
      };
      if (t.note !== undefined && t.note !== null) taskObj.note = t.note;
      if (t.completedAt !== undefined && t.completedAt !== null) taskObj.completedAt = t.completedAt;
      if (typeof t.timeSpentSeconds === 'number') taskObj.timeSpentSeconds = t.timeSpentSeconds;
      if (t.timerRunning !== undefined) taskObj.timerRunning = Boolean(t.timerRunning);
      if (typeof t.timerStartedAt === 'number') taskObj.timerStartedAt = t.timerStartedAt;
      if (t.autoPausedOverdue !== undefined) taskObj.autoPausedOverdue = Boolean(t.autoPausedOverdue);
      if (t.stepList && Array.isArray(t.stepList)) {
        taskObj.stepList = t.stepList.map((st) => ({
          id: st.id,
          title: st.title,
          done: Boolean(st.done),
        }));
      }
      return taskObj;
    }),
    tabs: (merged.tabs || []).map((tb) => {
      const tabObj: Record<string, any> = {
        id: tb.id,
        name: tb.name,
      };
      if (tb.color) tabObj.color = tb.color;
      return tabObj;
    }),
    deletedTasks: (merged.deletedTasks || []).map((t) => {
      const delObj: Record<string, any> = {
        id: t.id,
        title: t.title,
        phase: t.phase,
        priority: t.priority,
        steps: t.steps,
        currentStep: t.currentStep,
        done: Boolean(t.done),
        pinned: Boolean(t.pinned),
        createdAt: t.createdAt || Date.now(),
        deletedAt: t.deletedAt || Date.now(),
      };
      if (t.note !== undefined && t.note !== null) delObj.note = t.note;
      if (t.completedAt !== undefined && t.completedAt !== null) delObj.completedAt = t.completedAt;
      if (typeof t.timeSpentSeconds === 'number') delObj.timeSpentSeconds = t.timeSpentSeconds;
      if (t.timerRunning !== undefined) delObj.timerRunning = Boolean(t.timerRunning);
      if (typeof t.timerStartedAt === 'number') delObj.timerStartedAt = t.timerStartedAt;
      if (t.autoPausedOverdue !== undefined) delObj.autoPausedOverdue = Boolean(t.autoPausedOverdue);
      if (t.stepList && Array.isArray(t.stepList)) {
        delObj.stepList = t.stepList.map((st) => ({
          id: st.id,
          title: st.title,
          done: Boolean(st.done),
        }));
      }
      return delObj;
    }),
    settings: {
      soundEnabled: Boolean(merged.settings?.soundEnabled),
      fireEnabled: Boolean(merged.settings?.fireEnabled),
      lang: merged.settings?.lang || 'uk',
      aiIconVariant: merged.settings?.aiIconVariant || 'quantum',
    },
    updatedAt: Date.now(),
    revision: (Number(snapshot.data()?.revision) || 0) + 1,
  };

  const cleanPayload = sanitizeForFirestore(rawPayload);
  transaction.set(userDocRef, cleanPayload, { merge: true });
  return cleanPayload as UserCloudState;
  });
}

// Load user data from Firestore
export async function fetchUserCloudData(userId: string): Promise<UserCloudState | null> {
  const userDocRef = doc(db, 'users', userId);
  const snapshot = await getDocFromServer(userDocRef);
  if (snapshot.exists()) {
    return snapshot.data() as UserCloudState;
  }
  return null;
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
        onData(snapshot.data() as UserCloudState);
      }
    },
    (error) => {
      console.error('Error listening to user cloud data:', error);
      if (onError) onError(error);
    }
  );
}
