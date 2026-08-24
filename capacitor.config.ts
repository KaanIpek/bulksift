import type { CapacitorConfig } from '@capacitor/cli';

/** Wraps the same build that runs on the web into an Android or iOS app.
 *  Nothing platform-specific lives in the game itself: `npm run cap:sync`
 *  copies dist/ into the native shell and that is the whole story. */
const config: CapacitorConfig = {
  appId: 'com.kaanipek.frontline',
  appName: 'Frontline',
  webDir: 'dist',
  android: {
    // The game paints its own background; letting the webview flash white
    // between splash and first frame is the only jarring moment it has.
    backgroundColor: '#dfe7ef',
  },
  ios: {
    backgroundColor: '#dfe7ef',
    contentInset: 'never',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#dfe7ef',
      showSpinner: false,
    },
  },
};

export default config;
