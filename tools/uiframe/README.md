# Phone-frame preview

The mobile app runs in a browser through react-native-web (`npx expo start --web`
in `apps/mobile`), but a desktop window is the wrong shape to judge a phone
layout in - everything looks roomy at 1500 px wide and cramped at 390.

This page puts the running app inside a 390x844 frame and scales the frame to
whatever the window is, so what is on screen is what is on the phone. Serve it
next to the dev server:

    python -m http.server 8090 --directory tools/uiframe

`?n=2` puts two frames side by side, for comparing two states at once.

The app writes its collection to `localStorage` on the web, so a demo
collection can be dropped in from the browser console on the dev server's own
origin. Note that a running app overwrites that key on its next debounced save,
so set the value and reload in the same statement.
