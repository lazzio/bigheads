import { getPackageJson, ExpoConfig } from "expo/config";

const { version } = getPackageJson(__dirname);

const config: ExpoConfig = {
  version,
  name: "Les Intégrales BigHeads",
  slug: "bigheads",
  description: "Les Intégrales BigHeads",
  owner: "lazzio",
  orientation: "portrait",
  userInterfaceStyle: "light",
  scheme: "xyz.myops.bigheads",
  backgroundColor: "#121212", // Changed from #F6F6F6 to match app theme
  icon: "./assets/images/bh_opti.png",
  updates: {
      "fallbackToCacheTimeout": 0
    },

  splash: {
    image: "./assets/images/bh_opti.png",
    resizeMode: "cover",
    backgroundColor: "#b48d7b"
  },
  
  ios: {
    "supportsTablet": true,
    "infoPlist": {
      "UIBackgroundModes": ["audio"]
    }
  },

  android: {
    package: "xyz.myops.bigheads",
    permissions: [
      "FOREGROUND_SERVICE",
      "WAKE_LOCK",
      "POST_NOTIFICATIONS"
    ],
    foregroundService: {
      enabled: true,
      notificationTitle: 'Lecture en cours',
      notificationBody: 'Écoute de votre podcast',
      notificationColor: '#b48d7b',
      startInForeground: true
    }
  },
  platforms: ["android"],
  plugins: [
    "expo-router",
    [
      "expo-av",
      {
        "microphonePermission": false
      },
    ],
    "expo-notifications",
    [
      "expo-build-properties",
      {
        android: {
          compileSdkVersion: 35,
          targetSdkVersion: 35,
          buildToolsVersion: "35.0.0",
          enableProguardInReleaseBuilds: true,
          enableDexGuardInReleaseBuilds: true,
          kotlinVersion: "1.9.25",
        }
      }
    ],
    [
      "@sentry/react-native/expo",
      {
        "organization": "myops",
        "project": "bigheads-app",
        "url": "https://sentry.io/"
      }
    ]
  ],
  extra: {
    "router": {
        "origin": false
    },
    eas: {
      projectId: "891a7461-aa6c-432c-9d03-2b4f6e54b742"
    }
  },
  experiments: {
    typedRoutes: true
  }
} as ExpoConfig;

export default config;
