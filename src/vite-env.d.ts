/// <reference types="vite/client" />

interface NavigatorGPU {
  gpu: GPU;
}

interface Navigator {
  gpu?: GPU;
  deviceMemory?: number;
  connection?: {
    effectiveType?: string;
    downlink?: number;
  };
  storage: StorageManager;
}

interface StorageManager {
  persist(): Promise<boolean>;
  persisted(): Promise<boolean>;
  estimate(): Promise<{ quota?: number; usage?: number }>;
}
