/**
 * The one Firebase Auth instance, published without importing Firebase.
 *
 * `src/lib/firebase.js` creates it with `initializeAuth()`. Anything else that
 * needs it reads it from here instead of calling `getAuth()`: a `getAuth()`
 * that happened to run first would create the instance with IndexedDB
 * persistence and the popup redirect resolver attached, which is precisely the
 * configuration the switch to `initializeAuth()` removes.
 */

/** @type {any} */
let instance = null;

export function setAuthInstance(auth) {
  instance = auth || null;
}

export function getAuthInstance() {
  return instance;
}
