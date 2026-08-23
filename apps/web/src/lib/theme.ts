export const THEME = {
  LIGHT: "light",
  DARK: "dark",
  SYSTEM: "system",
} as const;

export type Theme = (typeof THEME)[keyof typeof THEME];

/**
 * The theme choices in display order — one list for the header's menu and the
 * profile page's Appearance section, so the two pickers can't disagree on what
 * exists or what it's called.
 */
export const THEME_OPTIONS: readonly { value: Theme; label: string }[] = [
  { value: THEME.LIGHT, label: "Light" },
  { value: THEME.DARK, label: "Dark" },
  { value: THEME.SYSTEM, label: "System" },
];

export function isTheme(value: string | undefined): value is Theme {
  return THEME_OPTIONS.some((option) => option.value === value);
}
