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

  splash: {
    image: "./assets/images/bh_opti.png",
    resizeMode: "cover",
    backgroundColor: "#b48d7b"
  },
  
  android: {
    softwareKeyboardLayoutMode: "pan",
    package: "xyz.myops.bigheads",
  },
  platforms: ["android"],
  plugins: [
    "expo-router",
    "expo-av",
    [
      "expo-build-properties",
      {
        android: {
          compileSdkVersion: 35,
          targetSdkVersion: 35,
          buildToolsVersion: "35.0.0",
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
