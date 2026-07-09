import type { ThemeMode } from '@/db/types';

export function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  const preferDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = theme === 'dark' || (theme === 'system' && preferDark);
  const sepia = theme === 'sepia';
  root.classList.toggle('dark', dark);
  root.classList.toggle('sepia', sepia);
}
