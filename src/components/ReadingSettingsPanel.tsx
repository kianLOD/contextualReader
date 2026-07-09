import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import type { AppSettings, CacheMode, ThemeMode } from '@/db/types';
import { cn } from '@/lib/utils';
import { MoonIcon, SunIcon, XIcon } from 'lucide-react';

type ReadingSettingsProps = {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onChange: (next: AppSettings) => void;
  onToggleCachePaused: () => void;
};

const CACHE_OPTIONS: { id: CacheMode; label: string; hint: string }[] = [
  { id: 'off', label: 'Off', hint: 'No background warm-up' },
  { id: 'less', label: 'Less', hint: 'Only current page / a few words' },
  { id: 'full', label: 'Full', hint: 'Warm the whole chapter when idle' },
];

export function ReadingSettingsPanel({
  open,
  settings,
  onClose,
  onChange,
  onToggleCachePaused,
}: ReadingSettingsProps) {
  const [theme, setTheme] = useState<ThemeMode>(settings.theme);

  useEffect(() => {
    setTheme(settings.theme);
  }, [settings.theme]);

  if (!open) return null;

  function setThemeMode(next: ThemeMode) {
    setTheme(next);
    onChange({ ...settings, theme: next });
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-sm flex-col gap-5 overflow-y-auto border-l border-border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">Reading settings</h2>
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            onClick={onClose}
            aria-label="Close settings"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Appearance</h3>
          <div className="flex gap-2">
            {(
              [
                { id: 'light', icon: SunIcon, label: 'Light' },
                { id: 'dark', icon: MoonIcon, label: 'Dark' },
                { id: 'system', icon: SunIcon, label: 'System' },
              ] as const
            ).map((opt) => (
              <Button
                key={opt.id}
                type="button"
                size="sm"
                variant={theme === opt.id ? 'default' : 'outline'}
                onClick={() => setThemeMode(opt.id)}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </section>

        <Separator />

        <section className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Meaning on hover</p>
            <p className="text-xs text-muted-foreground">
              Desktop: show gloss when hovering a rare word
            </p>
          </div>
          <Switch
            checked={settings.hoverMeanings}
            onCheckedChange={(checked) =>
              onChange({ ...settings, hoverMeanings: checked })
            }
          />
        </section>

        <Separator />

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Meaning cache</h3>
          <p className="text-xs text-muted-foreground">
            Background warm-up of rare-word meanings. Live taps always work.
          </p>
          <div className="flex flex-col gap-2">
            {CACHE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={cn(
                  'rounded-lg border px-3 py-2 text-left transition-colors',
                  settings.cacheMode === opt.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/50',
                )}
                onClick={() => onChange({ ...settings, cacheMode: opt.id })}
              >
                <span className="text-sm font-medium">{opt.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {opt.hint}
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 pt-1">
            <div>
              <p className="text-sm font-medium">Pause warm-up</p>
              <p className="text-xs text-muted-foreground">Stop / start without changing mode</p>
            </div>
            <Switch
              checked={settings.cachePaused}
              disabled={settings.cacheMode === 'off'}
              onCheckedChange={() => onToggleCachePaused()}
            />
          </div>
        </section>
      </aside>
    </div>
  );
}
