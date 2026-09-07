import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocFromServer,
  onSnapshot,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { PSTask, TaskTab, DeletedTask } from '../types';

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

// Validate connection to Firestore on boot as required by system guidelines
async function testFirestoreConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore client is offline or network is unavailable.');
    }
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
}

// Sign in with Google Popup
export async function loginWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
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
  data: {
    tasks: PSTask[];
    tabs: TaskTab[];
    deletedTasks: DeletedTask[];
    settings: {
      soundEnabled: boolean;
      fireEnabled: boolean;
      lang: string;
      aiIconVariant: string;
    };
  }
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid !== userId) {
    throw new Error('User is not authorized to save this cloud data');
  }

  const rawPayload = {
    userId,
    email: currentUser.email ?? null,
    displayName: currentUser.displayName ?? null,
    photoURL: currentUser.photoURL ?? null,
    tasks: (data.tasks || []).map((t) => {
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
      if (t.stepList && Array.isArray(t.stepList)) {
        taskObj.stepList = t.stepList.map((st) => ({
          id: st.id,
          title: st.title,
          done: Boolean(st.done),
        }));
      }
      return taskObj;
    }),
    tabs: (data.tabs || []).map((tb) => {
      const tabObj: Record<string, any> = {
        id: tb.id,
        name: tb.name,
      };
      if (tb.color) tabObj.color = tb.color;
      return tabObj;
    }),
    deletedTasks: (data.deletedTasks || []).map((t) => {
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
      soundEnabled: Boolean(data.settings?.soundEnabled),
      fireEnabled: Boolean(data.settings?.fireEnabled),
      lang: data.settings?.lang || 'uk',
      aiIconVariant: data.settings?.aiIconVariant || 'quantum',
    },
    updatedAt: Date.now(),
  };

  const cleanPayload = sanitizeForFirestore(rawPayload);
  const userDocRef = doc(db, 'users', userId);
  await setDoc(userDocRef, cleanPayload, { merge: true });
}

// Load user data from Firestore
export async function fetchUserCloudData(userId: string): Promise<UserCloudState | null> {
  const userDocRef = doc(db, 'users', userId);
  const snapshot = await getDoc(userDocRef);
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
    (snapshot) => {
      if (snapshot.exists()) {
        onData(snapshot.data() as UserCloudState);
      }
    },
    (error) => {
      console.error('Error listening to user cloud data:', error);
      if (onError) onError(error);
    }
  );
}
