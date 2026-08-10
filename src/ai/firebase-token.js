import { getAuth } from "firebase/auth";

export async function getFirebaseIdToken(forceRefresh = false) {
  try {
    const user = getAuth().currentUser;
    if (!user) return "";
    return user.getIdToken(forceRefresh === true);
  } catch (_error) {
    return "";
  }
}
