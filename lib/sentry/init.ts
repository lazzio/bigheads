import * as Sentry from "@sentry/react-native";
import { isRunningInExpoGo } from "expo";

import { navigationIntegration } from "./integrations/navigation";

export const initSentry = () => {
    return new Promise((resolve) => {
      // État pour suivre si l'initialisation est terminée
      let isInitialized = false;
      
      // Timer de timeout
      const timeoutId = setTimeout(() => {
        if (!isInitialized) {
          console.warn('[Sentry] Initialisation abandonnée après 5 secondes (timeout)');
          isInitialized = true;
          
          // Si Sentry a déjà été partiellement initialisé, on peut essayer de le désactiver
          try {
            Sentry.close();
          } catch (e) {
            // Ignorer les erreurs lors de la fermeture
          }
          
          resolve(false);
        }
      }, 5000);
      
      // Initialisation non-bloquante (dans la prochaine tick du JS event loop)
      setTimeout(() => {
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
              if (event.exception?.values?.some(exception => 
                exception.value?.includes('Attempted to navigate before mounting') ||
                exception.value?.includes('View config getter callback for component `path`')
              )) {
                return null;
              }
              return event;
            },
          });
          
          if (!isInitialized) {
            isInitialized = true;
            clearTimeout(timeoutId);
            
            if (__DEV__) {
              console.log('[Sentry] Initialisation réussie');
            }
            
            resolve(true);
          }
        } catch (error) {
          if (!isInitialized) {
            isInitialized = true;
            clearTimeout(timeoutId);
            console.error('[Sentry] Échec de l\'initialisation:', error);
            resolve(false);
          }
        }
      }, 0);
    });
  };
