IRONLOG V2 — FIREBASE CLOUD SYNC

Firebase web config is preloaded from firebase-config.js for all devices. You do not need to paste it into Settings on each phone/computer.

Deployment without command line:
1. Extract ZIP.
2. Open your existing Netlify project > Deploys.
3. Drag the entire extracted folder into the manual deploy area.
4. Open https://ironlog-gym-7920.netlify.app/ and reload.
5. In Settings sign in with Google; your Netlify hostname must be in Firebase Auth authorized domains.
6. Confirm cloud sync by editing a set, then inspecting Firestore users/{uid}/state/draft.

Firestore rules in firestore.rules. Firebase Google auth is per browser/device and cannot be globally bypassed. Offline edits save locally. Avoid simultaneously editing a workout across devices.

If Firebase reports an invalid API key, compare firebase-config.js with the exact web config in Firebase Console > Project settings > Your apps.
