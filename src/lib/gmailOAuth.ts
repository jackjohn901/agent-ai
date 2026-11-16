import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Strict security policy: Gmail OAuth tokens are kept ONLY in volatile JS memory, never localStorage/sessionStorage.
const memoryGmailTokens = new Map<string, string>();

function getFirebaseAuthInstance() {
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  return getAuth(app);
}

export function getCachedGmailToken(email: string | undefined | null): string | undefined {
  if (!email) return undefined;
  return memoryGmailTokens.get(email.trim().toLowerCase());
}

export function clearCachedGmailToken(email: string | undefined | null) {
  if (!email) return;
  memoryGmailTokens.delete(email.trim().toLowerCase());
}

export async function authorizeGmailAccount(): Promise<{ email: string; accessToken: string }> {
  const auth = getFirebaseAuthInstance();
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/gmail.send');
  provider.addScope('https://www.googleapis.com/auth/gmail.readonly');
  provider.addScope('https://www.googleapis.com/auth/userinfo.email');
  provider.setCustomParameters({ prompt: 'select_account' });

  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken;
  const email = (result.user?.email || '').trim().toLowerCase();

  if (!accessToken || !email) {
    throw new Error('Google Workspace authorization did not return a Gmail access token.');
  }

  memoryGmailTokens.set(email, accessToken);
  return { email, accessToken };
}
