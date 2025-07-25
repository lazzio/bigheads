import { getPackageJson, ExpoConfig } from "expo/config";

const { version } = getPackageJson(__dirname);

const config: ExpoConfig = {
  version,
  name: "Les Intégrales BigHeads",
  slug: "bigheads",
  description: "Les Intégrales BigHeads",
  owner: "lazzio",
  orientation: "default",
  userInterfaceStyle: "light",
  scheme: "xyz.myops.bigheads",
  backgroundColor: "#121212", // Changed from #F6F6F6 to match app theme
  icon: "./assets/images/bh_opti.png",
  platforms: ["android", "ios"],
  newArchEnabled: false,

  splash: {
    image: "./assets/images/bh_opti.png",
    resizeMode: "cover",
    backgroundColor: "#b48d7b"
  },
  
  android: {
    edgeToEdgeEnabled: true,
    versionCode: 10,
    adaptiveIcon: {
      foregroundImage: "./assets/images/bh_opti.png",
      backgroundColor: "#b48d7b"
    },
    screenOrientation: "default",
    softwareKeyboardLayoutMode: "pan",
    modeConfig: {
      service: {
        enabled: true,
        notificationTitle: 'BigHeads Integrals',
        notificationBody: 'Écoute en cours',
        notificationColor: '#b48d7b',
        foregroundService: true,
      }
    },
    package: "xyz.myops.bigheads",
    permissions: [
      'FOREGROUND_SERVICE',
      'WAKE_LOCK',
      'RECEIVE_BOOT_COMPLETED',
      'SCHEDULE_EXACT_ALARM',
      'POST_NOTIFICATIONS'
    ],
    foregroundService: {
      enabled: true,
      notificationTitle: 'Lecture en cours',
      notificationBody: 'Écoute de votre podcast',
      notificationColor: '#b48d7b',
    }
  },
  plugins: [
    "expo-router",
    "expo-font",
    [
      "expo-build-properties",
      {
        android: {
          compileSdkVersion: 35,
          targetSdkVersion: 35,
          buildToolsVersion: "35.0.0",
          kotlinVersion: "1.9.25",
          enableProguardInReleaseBuilds: true,
        }
      }
    ],
    [
      "@sentry/react-native/expo",
      {
        "organization": "myops",
        "project": "bigheads-app",
        "url": "https://sentry.io/",
      }
    ],
    [
      "expo-notifications",
      {
        icon: "./assets/images/bh_opti.png",
        color: '#b48d7b'
      }
    ],
    "expo-background-fetch",
    "expo-task-manager"
  ],
  notification: {
    icon: "./assets/images/bh_opti.png",
    color: "#b48d7b",
    iosDisplayInForeground: true,
  },
  extra: {
    "router": {
        "origin": false
    },
    eas: {
      projectId: "891a7461-aa6c-432c-9d03-2b4f6e54b742"
    }
  },
  updates: {
    enabled: true,
    checkAutomatically: "ON_ERROR_RECOVERY",
    fallbackToCacheTimeout: 0,
  },
  experiments: {
    typedRoutes: true
  }
} as ExpoConfig;

export default config;
