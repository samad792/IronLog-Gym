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
  generation: 0, conflicts: {data:false,draft:false},
};

function show(status, detail = '') {
  state.status = status;
  state.detail = detail;
  bridge.setStatus(status, detail);
}
function updateStatus() {
  if (!state.user) return show(state.auth ? 'Sign in required' : 'Local only', state.auth ? 'Connect your Google account in Settings' : 'Connect Firebase in Settings');
  if (state.conflicts.data || state.conflicts.draft) return show('Review sync', 'Choose which saved copy to use; both copies are unchanged');
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
  state.conflicts = {data:false,draft:false};
}
function isLocalDefault(data) {
  return bridge.isDefaultData(data);
}


const canonical=(value,kind)=>window.IronlogSyncSupport.canonical(value,kind);
function chooseSyncDirection(kind,local,meta,record){
  if(!record || !Object.prototype.hasOwnProperty.call(record,'value'))return 'local';
  if(canonical(local,kind)===canonical(record.value,kind))return 'equal';
  const localTime=Number(meta.modifiedAt)||0,cloudTime=Number(record.modifiedAt||record.updatedAt)||0;
  // Compare edit times before empty/default handling: a newer reset or draft
  // deletion is a real edit, and an older cloud snapshot must not undo it.
  if(localTime && cloudTime && localTime!==cloudTime)return localTime>cloudTime?'local':'remote';
  if(!meta.dirty && !localTime && ((kind==='data' && isLocalDefault(local)) || (kind==='draft' && !local)))return 'remote';
  if(!cloudTime && kind==='data' && isLocalDefault(record.value) && !isLocalDefault(local))return 'local';
  return 'conflict';
}
function changed(kind){
  if(!state.user)return;
  state.pending[kind]=true;state.conflicts[kind]=false;updateStatus();send(kind);
}
async function send(kind){
  const ref=state.refs[kind];if(!state.user || !ref || !state.initial[kind] || state.syncing[kind])return;
  if(!navigator.onLine){updateStatus();return;}
  state.syncing[kind]=true;state.pending[kind]=false;
  const generation=state.generation;
  let forced=null;
  try{
    while(generation===state.generation){
      const value=kind==='data'?bridge.getData():bridge.getDraft(),signature=canonical(value,kind),meta=bridge.getSyncMeta(kind);
      const stamp=Number(meta.modifiedAt)||0;
      const payload={value,modifiedAt:stamp||Date.now(),updatedAt:stamp||Date.now(),origin:CLIENT_ID,revision:CLIENT_ID+'-'+Date.now()+'-'+Math.random(),schemaVersion:2};
      // A transaction rechecks the current server copy before committing a write.
      const result=await state.firestore.runTransaction(state.db,async transaction=>{
        const snapshot=await transaction.get(ref);const record=snapshot.exists()?snapshot.data():null;
        let direction=chooseSyncDirection(kind,value,meta,record);
        if(forced && forced.local===signature && forced.remote===canonical(record,kind))direction=forced.direction;
        if(direction==='local'){transaction.set(ref,payload);return {direction,record:payload};}
        return {direction,record};
      });
      if(generation!==state.generation)return;
      const current=kind==='data'?bridge.getData():bridge.getDraft();
      if(canonical(current,kind)!==signature){forced=null;state.pending[kind]=false;continue;}
      if(result.direction==='conflict'){
        state.conflicts[kind]=true;updateStatus();
        const choice=await bridge.resolveSyncConflict(kind,value,meta,result.record);
        if(generation!==state.generation)return;
        if(choice==='later'){state.pending[kind]=true;return;}
        state.conflicts[kind]=false;
        forced={direction:choice,local:signature,remote:canonical(result.record,kind)};
        continue;
      }
      if(result.direction==='remote')bridge.acceptSynced(kind,result.record);
      else bridge.acknowledge(kind,result.record,signature);
      state.conflicts[kind]=false;state.error='';
      break;
    }
  }catch(err){if(generation!==state.generation)return;state.pending[kind]=true;state.error=kind+': '+err.message;}
  finally{if(generation===state.generation){state.syncing[kind]=false;updateStatus();if(state.pending[kind]&&!state.conflicts[kind]&&!state.error&&navigator.onLine)send(kind);}}
}
function initializeDocument(kind,snapshot){
  // Only a server snapshot can settle which copy is current. Cached values may be stale.
  if(snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites){updateStatus();return;}
  state.initial[kind]=true;state.pending[kind]=true;send(kind);
}
function watch(kind){
  const generation=state.generation;
  const unsubscribe=state.firestore.onSnapshot(state.refs[kind],{includeMetadataChanges:true},snapshot=>{
    if(generation!==state.generation)return;
    if(!state.initial[kind])return initializeDocument(kind,snapshot);
    if(snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites)return;
    const record=snapshot.exists()?snapshot.data():null;
    if(state.syncing[kind]){if(record?.origin!==CLIENT_ID)state.pending[kind]=true;return;}
    if(record?.origin===CLIENT_ID)return;
    state.pending[kind]=true;send(kind);
  },err=>{if(generation!==state.generation)return;state.error=err.message;updateStatus();});
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
    }, err => { state.error = err.message; show('Auth error', err.message); window.IronlogStartup?.fail(`Google account check failed: ${err.message}`); });
    show('Sign in required', 'Use the Google button in Settings');
  } catch (err) {
    state.error = err.message;
    show('Firebase error', `${err.message} — check config and internet`);
    window.IronlogStartup?.fail(`Firebase could not start: ${err.message}`);
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
  reviewConflicts: () => {for(const kind of ['data','draft'])if(state.conflicts[kind]){state.conflicts[kind]=false;send(kind);}},
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
    window.IronlogStartup?.fail('Firebase setup is missing from this website deployment.');
  }
} catch (err) { show('Config error', err.message); window.IronlogStartup?.fail(`Firebase configuration error: ${err.message}`); }
// Installable app shell; Firestore/Google login still require working internet
// until the SDK is cached and a Firebase session has already been established.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(err => console.warn('PWA offline shell unavailable:', err));
}
