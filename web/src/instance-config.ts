// Simple configuration module for instance settings
// This allows non-React code (like connect.ts interceptors) to access instance settings
// The values are updated by InstanceContext when it initializes

interface InstanceConfig {
  memoRelatedSetting: {
    disallowPublicVisibility: boolean;
    enableExplore: boolean;
  };
}

let instanceConfig: InstanceConfig = {
  memoRelatedSetting: {
    disallowPublicVisibility: false,
    enableExplore: false,
  },
};

export function getInstanceConfig(): InstanceConfig {
  return instanceConfig;
}

export function updateInstanceConfig(config: Partial<InstanceConfig>): void {
  instanceConfig = { ...instanceConfig, ...config };
}
