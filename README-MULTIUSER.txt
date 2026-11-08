IRONLOG V3 — PRIVATE DATA PER GOOGLE ACCOUNT

FIX: Different Google sign-in accounts no longer inherit the previous person's locally cached workouts.
Every signed-in UID now has separate data and unfinished-workout draft storage, and Firestore
continues using users/{uid}/state/{main,draft} with the user-specific security rules.
Signing out switches to a separate guest workspace. Signing in loads the corresponding UID's
local cache first and then synchronizes with that UID's Firestore documents.

IMPORTANT: Old unscoped local test records are deliberately not imported into ANY user
account; this prevents one user's records being uploaded to another person's cloud documents.
Old data stays in its original legacy browser storage until the browser clears it.
Existing Firestore data remains intact. If you want old legacy records back, recover using
your previous deployment and manually export/import a backup while in the intended account.

DEPLOY WITHOUT COMMANDS:
1. Unzip ironlog-v3-multiuser.zip.
2. Netlify Dashboard > your IRONLOG site > Deploys > manual deploy: drag the ENTIRE
   extracted ironlog-v3-multiuser folder (not this zip alone or just index.html).
3. Wait until Published. Open https://ironlog-gym-7920.netlify.app/.
4. Refresh the mobile home-screen app; the service worker cache version is upgraded.
5. Log in with Google A and add a test workout. Log out, log in with Google B.
   B must show its OWN workouts or an empty history, not A's history.
6. Sign back into Google A to confirm A's data returns. Verify each Firestore UID path.

WARNING: If a browser has been used with the older version while signing into the wrong
account, the older version may already have uploaded another user's local data to the
wrong Firebase UID. This update prevents new cross-account uploads, but cannot determine
which prior records belong to which person. Delete such mistaken test records manually.

Firebase live sync requires internet, and signing into each device is still required.
Offline unsynced edits are stored in browser storage separately for each UID. Switching
accounts with pending cloud writes can postpone synchronization; allow 'Cloud synced'
first when possible. Don't edit the same workout on two devices simultaneously.
