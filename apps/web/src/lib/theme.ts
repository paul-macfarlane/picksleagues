export const THEME = {
  LIGHT: "light",
  DARK: "dark",
  SYSTEM: "system",
} as const;

export type Theme = (typeof THEME)[keyof typeof THEME];

/**
 * The theme choices in display order. One list, one picker (the profile
 * page's Appearance section — the header menu no longer carries one), kept
 * apart from the component so the values next-themes persists and the labels
 * a member sees stay one declaration.
 */
export const THEME_OPTIONS: readonly { value: Theme; label: string }[] = [
  { value: THEME.LIGHT, label: "Light" },
  { value: THEME.DARK, label: "Dark" },
  { value: THEME.SYSTEM, label: "System" },
];

export function isTheme(value: string | undefined): value is Theme {
  return THEME_OPTIONS.some((option) => option.value === value);
}
