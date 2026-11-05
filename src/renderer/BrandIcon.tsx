import { BRAND_ICONS, usePreferences } from './preferences';
export function BrandIcon({ className = 'brand-mark' }: { className?: string }) {
  const theme = usePreferences((s) => s.preferences.theme);
  return (
    <img
      className={className}
      src={BRAND_ICONS[theme]}
      data-theme-icon={theme}
      alt=""
      aria-hidden="true"
    />
  );
}
