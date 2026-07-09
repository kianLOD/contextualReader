import { MODEL_TIERS, type ModelTierId } from '@/constants/modelTiers';

export type SystemCheckResult = {
  webgpu: boolean;
  recommendedTier: ModelTierId;
  runnable: Record<ModelTierId, boolean>;
  deviceMemoryGb: number | null;
  cores: number;
  isMobile: boolean;
  storageQuotaBytes: number | null;
  storageUsageBytes: number | null;
  connectionEffectiveType: string | null;
  downlinkMbps: number | null;
  warnings: string[];
  blockReason: string | null;
};

function detectMobile(): boolean {
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints > 1;
  const small = Math.min(screen.width, screen.height) < 768;
  return /Mobi|Android|iPhone|iPad/i.test(ua) || (touch && small);
}

export async function runSystemCheck(): Promise<SystemCheckResult> {
  const warnings: string[] = [];
  const webgpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  let maxBufferSize = 0;
  let maxStorageBufferBindingSize = 0;

  if (webgpu && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        maxBufferSize = adapter.limits.maxBufferSize;
        maxStorageBufferBindingSize = adapter.limits.maxStorageBufferBindingSize;
      } else {
        warnings.push('WebGPU adapter unavailable.');
      }
    } catch {
      warnings.push('WebGPU adapter request failed.');
    }
  }

  const deviceMemoryGb =
    'deviceMemory' in navigator ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory) : null;
  const cores = navigator.hardwareConcurrency || 2;
  const isMobile = detectMobile();

  let storageQuotaBytes: number | null = null;
  let storageUsageBytes: number | null = null;
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      storageQuotaBytes = est.quota ?? null;
      storageUsageBytes = est.usage ?? null;
    }
  } catch {
    /* ignore */
  }

  const connection = (navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number };
  }).connection;
  const connectionEffectiveType = connection?.effectiveType ?? null;
  const downlinkMbps = connection?.downlink ?? null;

  if (connectionEffectiveType === '2g' || connectionEffectiveType === 'slow-2g') {
    warnings.push('Slow network detected — model download may take a long time.');
  } else if (downlinkMbps !== null && downlinkMbps < 1.5) {
    warnings.push('Low bandwidth detected — prefer the Light tier.');
  }

  const healthyGpu =
    maxBufferSize >= 2 * 1024 * 1024 * 1024 ||
    maxStorageBufferBindingSize >= 1 * 1024 * 1024 * 1024;

  let recommendedTier: ModelTierId = 'balanced';
  if (isMobile || (deviceMemoryGb !== null && deviceMemoryGb <= 4)) {
    recommendedTier = 'light';
  } else if (deviceMemoryGb !== null && deviceMemoryGb >= 8 && healthyGpu) {
    recommendedTier = 'balanced';
  }

  const freeBytes =
    storageQuotaBytes !== null && storageUsageBytes !== null
      ? storageQuotaBytes - storageUsageBytes
      : null;

  const runnable: Record<ModelTierId, boolean> = {
    light: webgpu,
    balanced: webgpu && !(isMobile && (deviceMemoryGb ?? 8) <= 4),
    best: webgpu && !isMobile && (deviceMemoryGb ?? 0) >= 8 && healthyGpu,
  };

  for (const tier of MODEL_TIERS) {
    if (!runnable[tier.id]) continue;
    if (freeBytes !== null) {
      const need = tier.downloadGb * 1024 * 1024 * 1024 * 1.2;
      if (freeBytes < need) {
        runnable[tier.id] = false;
        warnings.push(`Not enough storage for ${tier.label} (~${tier.downloadGb} GB).`);
      }
    }
  }

  if (!runnable[recommendedTier]) {
    recommendedTier =
      (['light', 'balanced', 'best'] as ModelTierId[]).find((id) => runnable[id]) ?? 'light';
  }

  const blockReason = !webgpu
    ? 'This browser does not support WebGPU. Contextual Reader needs a recent Chrome or Edge on desktop.'
    : null;

  return {
    webgpu,
    recommendedTier,
    runnable,
    deviceMemoryGb,
    cores,
    isMobile,
    storageQuotaBytes,
    storageUsageBytes,
    connectionEffectiveType,
    downlinkMbps,
    warnings,
    blockReason,
  };
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function storageNeededWarning(
  check: SystemCheckResult,
  downloadGb: number,
): string | null {
  if (check.storageQuotaBytes == null || check.storageUsageBytes == null) return null;
  const free = check.storageQuotaBytes - check.storageUsageBytes;
  const need = downloadGb * 1024 * 1024 * 1024 * 1.2;
  if (free < need) {
    return `Storage looks tight for a ~${downloadGb} GB download. Free some space before continuing.`;
  }
  if (free < need * 1.5) {
    return `Download is ~${downloadGb} GB. You have limited free storage — consider the Light tier.`;
  }
  return null;
}
