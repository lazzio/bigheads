import { reactNavigationIntegration } from "@sentry/react-native";
import { isRunningInExpoGo } from "expo";

export const navigationIntegration = reactNavigationIntegration({
  enableTimeToInitialDisplay: !isRunningInExpoGo(),
});

