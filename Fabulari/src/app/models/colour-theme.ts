// Group themes follow the Fabulari logo colours. Must match COLOUR_THEMES on the server.
export const COLOUR_THEMES = ['Blue', 'Yellow', 'Red'] as const;

export type ColourTheme = (typeof COLOUR_THEMES)[number];

// Semi-transparent tints so text stays readable in both light and dark mode.
export const THEME_TINTS: Record<ColourTheme, string> = {
  Blue: 'rgba(31, 95, 191, 0.15)',
  Yellow: 'rgba(242, 184, 7, 0.2)',
  Red: 'rgba(204, 32, 39, 0.15)',
};
