/** Frozen model-tier table — do not edit to make tests pass. */

export type ModelTierId = 'light' | 'balanced' | 'best';

export type ModelTier = {
  id: ModelTierId;
  label: string;
  /** WebLLM model id */
  modelId: string;
  downloadGb: number;
  quality: string;
  defaultFor: string;
};

/** Use q4f32 (not q4f16): many Intel iGPUs reject WGSL `enable f16`. */
export const MODEL_TIERS: readonly ModelTier[] = [
  {
    id: 'light',
    label: 'Light',
    modelId: 'Llama-3.2-1B-Instruct-q4f32_1-MLC',
    downloadGb: 0.8,
    quality: 'basic meanings, weak nuance',
    defaultFor: 'mobile, ≤4GB RAM, slow net',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    modelId: 'Llama-3.2-3B-Instruct-q4f32_1-MLC',
    downloadGb: 2.0,
    quality: 'solid meanings, decent idioms',
    defaultFor: 'most laptops (default)',
  },
  {
    id: 'best',
    label: 'Best',
    modelId: 'Llama-3.1-8B-Instruct-q4f32_1-MLC',
    downloadGb: 5.0,
    quality: 'strong cultural/nuance',
    defaultFor: 'desktop with real GPU',
  },
] as const;

export function getTier(id: ModelTierId): ModelTier {
  const tier = MODEL_TIERS.find((t) => t.id === id);
  if (!tier) throw new Error(`Unknown model tier: ${id}`);
  return tier;
}
