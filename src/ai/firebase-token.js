/* The single Auth instance is created by src/lib/firebase.js with
   initializeAuth(). getAuth() is not called here: if this module ever ran
   first it would create a second configuration - IndexedDB persistence plus
   the popup redirect resolver - which is what the switch to initializeAuth()
   exists to avoid. */
import { getAuthInstance } from "../features/auth/auth-instance.js";

export async function getFirebaseIdToken(forceRefresh = false) {
  try {
    const user = getAuthInstance()?.currentUser;
    if (!user) return "";
    return user.getIdToken(forceRefresh === true);
  } catch (_error) {
    return "";
  }
}
