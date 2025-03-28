import * as Sentry from "@sentry/react-native";
import { isRunningInExpoGo } from "expo";

import { navigationIntegration } from "./integrations/navigation";

export const initSentry = () => {
  try {
    Sentry.init({
      debug: false,
      enabled: !__DEV__ && !!process.env.EXPO_PUBLIC_SENTRY_DSN,
      environment: __DEV__ ? "development" : "production",
      dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 1.0,
      integrations: [navigationIntegration],
      enableNativeFramesTracking: !isRunningInExpoGo(),
      beforeSend: (event) => {
        return event;
      },
    });

    if (__DEV__) {
      console.log('[Sentry] Initialized successfully');
    }
  } catch (error) {
    console.error('[Sentry] Initialization failed:', error);
  }
};
