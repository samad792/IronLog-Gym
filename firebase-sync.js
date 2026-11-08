// IRONLOG Firebase bridge — no npm/build needed. Served as an ES module over HTTP(S).
// Persistent browser storage is always updated synchronously by index.html first.
const CONFIG_KEY = 'ironlog_firebase_config_v1';
const CLIENT_ID = globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random();
const bridge = window.IronlogBridge;
const state = {
  user: null, auth: null, authMod: null, db: null, firestore: null, app: null,
  listeners: [], refs: {}, initial: { data: false, draft: false },
  pending: { data: false, draft: false },
  timers: {}, syncing: { data: false, draft: false },
  status: 'Local only', detail: 'Connect Firebase in Settings', error: '',
  generation: 0,
};

function show(status, detail = '') {
  state.status = status;
  state.detail = detail;
  bridge.setStatus(status, detail);
}
function updateStatus() {
  if (!state.user) return show(state.auth ? 'Sign in required' : 'Local only', state.auth ? 'Connect your Google account in Settings' : 'Connect Firebase in Settings');
  if (state.error) return show('Sync error', state.error);
  if (!navigator.onLine) return show('Offline · saved locally', 'Changes will sync after your internet connection returns');
  if (!state.initial.data || !state.initial.draft) return show('Connecting…', 'Loading cloud training history');
  if (state.pending.data || state.pending.draft || state.syncing.data || state.syncing.draft) return show('Syncing…', 'Local edits saved; cloud confirmation pending');
  show('Cloud synced', 'Workouts and active session are up to date');
}
function stopListeners() {
  state.generation++;
  for (const unsubscribe of state.listeners) unsubscribe();
  state.listeners = [];
  for (const timer of Object.values(state.timers)) clearTimeout(timer);
  state.timers = {};
  state.refs = {};
  state.initial = { data: false, draft: false };
  state.pending = { data: false, draft: false };
  state.syncing = { data: false, draft: false };
  state.error = '';
}
function isLocalDefault(data) {
  return !data.workouts?.length && !data.weights?.length && !data.templates?.length && data.categories?.length === 3;
}

function changed(kind) {
  if (!state.user) return; // All changes are already persisted instantly in localStorage.
  state.pending[kind] = true;
  updateStatus();
  clearTimeout(state.timers[kind]);
  // Batch keystrokes to reduce writes and costs. Never delay local autosave.
  state.timers[kind] = setTimeout(() => send(kind), 350);
}
function send(kind) {
  const userId = state.user?.uid;
  const ref = state.refs[kind];
  if (!userId || !ref || !state.initial[kind]) return;
  if (state.syncing[kind]) return; // serialize cloud writes; do not falsely acknowledge newer edits
  if (!navigator.onLine) { updateStatus(); return; }
  const value = kind === 'data' ? bridge.getData() : bridge.getDraft();
  clearTimeout(state.timers[kind]);
  state.timers[kind] = null;
  state.pending[kind] = false;
  state.syncing[kind] = true;
  const generation = state.generation;
  const payload = { value, updatedAt: Date.now(), origin: CLIENT_ID, schemaVersion: 1 };
  // Firestore queues writes in its offline cache; only display "Cloud synced"
  // after the returned promise is acknowledged by the server.
  state.firestore.setDoc(ref, payload).then(() => {
    if (generation !== state.generation) return;
    state.syncing[kind] = false;
    state.error = '';
    if (state.pending[kind]) send(kind);
    updateStatus();
  }).catch(err => {
    if (generation !== state.generation) return;
    state.syncing[kind] = false;
    state.pending[kind] = true;
    state.error = `${kind}: ${err.message}`;
    updateStatus();
  });
  updateStatus();
}
function useRemote(kind, value) {
  if (kind === 'data') bridge.acceptData(value);
  else bridge.acceptDraft(value);
}
function initializeDocument(kind, snapshot) {
  // Do not take an incomplete offline-cache miss as proof the cloud is empty.
  if (!snapshot.exists() && snapshot.metadata.fromCache) {
    updateStatus();
    return;
  }
  const record = snapshot.exists() ? snapshot.data() : null;
  const local = kind === 'data' ? bridge.getData() : bridge.getDraft();
  const localHasData = kind === 'data' ? !isLocalDefault(local) : !!local;
  if (record && record.value != null) {
    const remote = record.value;
    const cloudHasData = kind === 'data' ? !isLocalDefault(remote) : !!remote;
    let keepLocal = false;
    if (localHasData && cloudHasData && JSON.stringify(local) !== JSON.stringify(remote)) {
      if (kind === 'data') {
        keepLocal = window.confirm('IRONLOG found BOTH local records and saved Firebase records.\n\nOK = Upload local records to Firebase (replaces cloud copy).\nCancel = Download Firebase records (replaces local copy).\n\nPlease export a JSON backup first if you need to preserve both.');
      } else {
        // Preserve most recent unfinished session, comparing autosave timestamps.
        keepLocal = Number(local.updatedAt || 0) > Number(remote.updatedAt || 0);
      }
    } else if (localHasData && !cloudHasData) keepLocal = true;
    if (!keepLocal) useRemote(kind, remote);
    state.initial[kind] = true;
    if (keepLocal) { state.pending[kind] = true; send(kind); }
  } else {
    state.initial[kind] = true;
    // Seed only this exact UID's own scoped local cache (never another identity's data).
    state.pending[kind] = true;
    send(kind);
  }
  updateStatus();
}
function watch(kind) {
  const generation = state.generation;
  const ref = state.refs[kind];
  const unsubscribe = state.firestore.onSnapshot(ref, { includeMetadataChanges: true }, snapshot => {
    if (generation !== state.generation) return;
    if (!state.initial[kind]) return initializeDocument(kind, snapshot);
    if (snapshot.metadata.hasPendingWrites || !snapshot.exists()) { updateStatus(); return; }
    const remote = snapshot.data();
    if (remote.origin === CLIENT_ID) { updateStatus(); return; }
    // Avoid overwriting active typed values with an incoming snapshot.
    if (state.pending[kind] || state.syncing[kind]) { updateStatus(); return; }
    const local = kind === 'data' ? bridge.getData() : bridge.getDraft();
    if (JSON.stringify(local) !== JSON.stringify(remote.value)) {
      useRemote(kind, remote.value);
      if (kind === 'draft') bridge.setStatus('Cloud updated', 'Another signed-in device updated your workout');
    }
    updateStatus();
  }, err => {
    if (generation !== state.generation) return;
    state.error = err.message;
    updateStatus();
  });
  state.listeners.push(unsubscribe);
}
function startSync(user) {
  stopListeners();
  // Switch the app's local data BEFORE binding Firestore or enabling writes.
  bridge.switchAccount(user.uid);
  state.user = user;
  state.refs.data = state.firestore.doc(state.db, 'users', user.uid, 'state', 'main');
  state.refs.draft = state.firestore.doc(state.db, 'users', user.uid, 'state', 'draft');
  show('Connecting…', 'Loading your Firebase records');
  watch('data');
  watch('draft');
}
async function configure(config) {
  if (state.user) throw new Error('Sign out before changing Firebase projects.');
  try {
    show('Connecting…', 'Loading Firebase SDK');
    const version = '11.10.0';
    const [appLib, authLib, fireLib] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${version}/firebase-firestore.js`),
    ]);
    if (state.auth) throw Error('Firebase already initialized. Reload the page to change projects.');
    state.app = appLib.initializeApp(config);
    state.authMod = authLib;
    state.firestore = fireLib;
    state.db = fireLib.initializeFirestore(state.app, {
      localCache: fireLib.persistentLocalCache({ tabManager: fireLib.persistentMultipleTabManager() }),
    });
    state.auth = authLib.getAuth(state.app);
    // Redirect return may complete after the page reloads on mobile browsers.
    authLib.getRedirectResult(state.auth).catch(err => {
      console.warn('[Ironlog redirect login]', err);
      show('Auth error', err.message);
    });
    authLib.onAuthStateChanged(state.auth, user => {
      if (user) startSync(user);
      else {
        stopListeners(); state.user = null;
        // Signed-out browsing has a separate guest cache, never the previous UID.
        bridge.switchAccount(null);
        updateStatus();
      }
      if (document.getElementById('firebase-account')) bridge.setStatus(state.status, state.detail);
    }, err => { state.error = err.message; show('Auth error', err.message); });
    show('Sign in required', 'Use the Google button in Settings');
  } catch (err) {
    state.error = err.message;
    show('Firebase error', `${err.message} — check config and internet`);
    console.error('[Ironlog Firebase]', err);
  }
}
async function signIn() {
  if (!state.auth) return alert('Firebase is still initializing or failed to load. Check your internet connection, then reload the page.');
  try {
    state.error = '';
    const provider = new state.authMod.GoogleAuthProvider();
    // Popup works on most desktop/mobile browsers. An installed iOS PWA may
    // restrict popups; show a useful error rather than silently doing nothing.
    await state.authMod.signInWithPopup(state.auth, provider);
  } catch (err) {
    state.error = err.message;
    updateStatus();
    alert(`Google sign-in failed: ${err.message}\n\nCheck Firebase Authentication → Google provider and authorized domains.`);
  }
}
async function signOut() {
  if (!state.auth) return;
  if ((state.pending.data || state.pending.draft || state.syncing.data || state.syncing.draft) &&
      !confirm('Some cloud changes may be pending. Your local data will remain, but signing out now may delay sync. Continue?')) return;
  await state.authMod.signOut(state.auth);
}
window.IronlogCloud = {
  changed, configure, signIn, signOut,
  label: () => state.status,
  accountLabel: () => state.user ? `Signed in: ${state.user.email}` : state.auth ? 'Firebase configured · Google sign-in required' : 'Firebase not configured',
  hasUser: () => !!state.user,
};
window.addEventListener('online', () => {
  state.error = '';
  for (const kind of ['data', 'draft']) if (state.pending[kind]) send(kind);
  updateStatus();
});
window.addEventListener('offline', updateStatus);
try {
  const bundled = window.IRONLOG_FIREBASE_CONFIG;
  if (bundled?.apiKey && bundled?.projectId && bundled?.appId) {
    // The same deployment supplies Firebase config to every browser/device.
    // Ignore legacy per-device config in favour of this site's configuration.
    configure(bundled);
  } else {
    show('Firebase setup error', 'Public web configuration is missing from deployment');
  }
} catch (err) { show('Config error', err.message); }
// Installable app shell; Firestore/Google login still require working internet
// until the SDK is cached and a Firebase session has already been established.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(err => console.warn('PWA offline shell unavailable:', err));
}
