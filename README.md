# Architecture Memory Quiz

Flip pairs, unlock questions, and score points.

## How to play
- Choose a role: Host or Player.
- Players enter a display name and tap "Join game".
- Use "Rename" to change the player name later.

## Realtime (Firebase Firestore)

### 1) Create a Firebase project
1. Go to https://console.firebase.google.com/ -> Add project.
2. Create Firestore Database (Test mode is fine for a demo).
3. Project settings -> Web app -> copy the config.

### 1b) Enable Anonymous Auth
1. In Firebase Console -> Authentication -> Sign-in method.
2. Enable Anonymous.

### 2) Paste config
Open `firebase-config.js` and paste the config:

```js
export const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "...",
};
```

### 3) Firestore rules (recommended)
These rules require authentication and restrict writes to the host or joined players:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{roomId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null
        && request.resource.data.hostId == request.auth.uid;
      allow update: if request.auth != null
        && (request.auth.uid == resource.data.hostId
          || request.auth.uid in resource.data.playerIds
          || request.auth.uid in request.resource.data.playerIds);
    }
  }
}
```

Note: If you previously used open rules, delete the old room document or press "New round" as host to refresh the schema.

### 4) Links
- Host: `...?role=host`
- Player: `...?role=player`

Open 3 tabs / 3 devices: 1 host + 2 players.

## Edit content

- Images: replace files in `assets/` and update `data/cards.json`.
- Questions: update `data/questions.json`.

Question format (mcq):

```json
{
  "id": "q1",
  "type": "mcq",
  "prompt": "Your question",
  "options": ["A", "B", "C", "D"],
  "answer": "A"
}
```

Question format (text):

```json
{
  "id": "q2",
  "type": "text",
  "prompt": "Your question",
  "answer": "Correct answer"
}
```

Multiple correct answers (text):

```json
{
  "id": "q3",
  "type": "text",
  "prompt": "Your question",
  "answer": ["Answer 1", "Answer 2"]
}
```

## Deploy to GitHub Pages

1. Push to GitHub.
2. Open Settings -> Pages.
3. Select Branch `main` (or `master`) and root folder `/`.
4. Save and wait for Pages to build.

## Local preview

Open `index.html` in a browser, or serve with any static server.
