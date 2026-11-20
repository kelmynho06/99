import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mobilidade66.app',
  appName: 'Boreal Mobilidade',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true,
    allowNavigation: ['*'],
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#F7FBFA',
  },
  plugins: {
    Geolocation: {
      enableHighAccuracy: true,
    },
    LocalNotifications: {
      smallIcon: 'ic_launcher',
      iconColor: '#0D9488',
    },
  },
};

export default config;
