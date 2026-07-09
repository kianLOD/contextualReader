import { useEffect, useMemo, useState } from 'react';
import { MODEL_TIERS, getTier, type ModelTierId } from '@/constants/modelTiers';
import {
  runSystemCheck,
  requestPersistentStorage,
  storageNeededWarning,
  type SystemCheckResult,
} from '@/lib/systemCheck';
import { checkModelCached, initModel } from '@/lib/modelClient';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type ModelManagerProps = {
  selectedTier: ModelTierId;
  modelReady: boolean;
  onTierChange: (tier: ModelTierId) => void;
  onReady: (opts: { tier: ModelTierId; persistGranted: boolean }) => void;
  onSkip?: () => void;
};

export function ModelManager({
  selectedTier,
  modelReady,
  onTierChange,
  onReady,
  onSkip,
}: ModelManagerProps) {
  const [check, setCheck] = useState<SystemCheckResult | null>(null);
  const [loadingCheck, setLoadingCheck] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<{
    prompt: () => Promise<void>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingCheck(true);
      const result = await runSystemCheck();
      if (!cancelled) {
        setCheck(result);
        if (!modelReady) onTierChange(result.recommendedTier);
        setLoadingCheck(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally run once on mount / when modelReady flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelReady]);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      const pe = e as Event & { prompt: () => Promise<void> };
      setDeferredPrompt(pe);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const tier = useMemo(() => getTier(selectedTier), [selectedTier]);
  const quotaWarning = check ? storageNeededWarning(check, tier.downloadGb) : null;

  async function startDownload(isRestore: boolean) {
    if (!check?.webgpu) return;
    setError(null);
    setDownloading(true);
    setRestoring(isRestore);
    setProgress(0);
    setProgressText(isRestore ? 'Restoring model…' : 'Downloading model…');
    try {
      const persistGranted = await requestPersistentStorage();
      await initModel(tier.modelId, (p, text) => {
        setProgress(Math.round(p * 100));
        setProgressText(text || (isRestore ? 'Restoring model…' : 'Downloading…'));
      });
      onReady({ tier: selectedTier, persistGranted });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Model download failed');
    } finally {
      setDownloading(false);
      setRestoring(false);
    }
  }

  async function ensureReady() {
    if (!check?.webgpu) return;
    const cached = await checkModelCached(tier.modelId);
    // If settings say ready but cache was evicted, show restoring state.
    await startDownload(Boolean(modelReady && !cached));
  }

  if (loadingCheck || !check) {
    return (
      <div className="mx-auto max-w-lg px-5 py-10">
        <p className="text-sm text-muted-foreground">Checking this device…</p>
      </div>
    );
  }

  if (check.blockReason) {
    return (
      <div className="mx-auto max-w-lg px-5 py-10">
        <Alert variant="destructive">
          <AlertTitle>WebGPU required</AlertTitle>
          <AlertDescription>{check.blockReason}</AlertDescription>
        </Alert>
        {onSkip && (
          <Button type="button" variant="ghost" className="mt-4" onClick={onSkip}>
            Back to library
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-5 px-5 py-10 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Local AI model</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Runs entirely in your browser. Download once; later visits load from cache.
        </p>
      </div>

      {check.warnings.map((w) => (
        <Alert key={w}>
          <AlertTitle>Notice</AlertTitle>
          <AlertDescription>{w}</AlertDescription>
        </Alert>
      ))}

      {quotaWarning && (
        <Alert>
          <AlertTitle>Storage</AlertTitle>
          <AlertDescription>{quotaWarning}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3">
        {MODEL_TIERS.map((t) => {
          const enabled = check.runnable[t.id];
          const selected = selectedTier === t.id;
          return (
            <button
              key={t.id}
              type="button"
              disabled={!enabled || downloading}
              onClick={() => onTierChange(t.id)}
              className={cn(
                'rounded-xl border p-4 text-left transition-colors',
                selected ? 'border-primary bg-primary/5' : 'border-border bg-card',
                !enabled && 'cursor-not-allowed opacity-50',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{t.label}</span>
                {check.recommendedTier === t.id && (
                  <Badge variant="secondary">Recommended</Badge>
                )}
                {!enabled && <Badge variant="outline">Unavailable</Badge>}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                ~{t.downloadGb} GB · {t.quality}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t.defaultFor}</p>
            </button>
          );
        })}
      </div>

      {downloading && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {restoring ? 'Restoring model…' : 'Downloading model…'}
            </CardTitle>
            <CardDescription className="truncate">{progressText}</CardDescription>
          </CardHeader>
          <CardContent>
            <Progress value={progress} />
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={downloading || !check.runnable[selectedTier]}
          onClick={() => void ensureReady()}
        >
          {modelReady ? 'Load model' : 'Download & enable'}
        </Button>
        {onSkip && (
          <Button type="button" variant="ghost" disabled={downloading} onClick={onSkip}>
            Not now
          </Button>
        )}
        {deferredPrompt && (
          <Button
            type="button"
            variant="outline"
            onClick={() => void deferredPrompt.prompt()}
          >
            Install as app
          </Button>
        )}
      </div>
    </div>
  );
}
