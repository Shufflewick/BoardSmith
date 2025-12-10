/**
 * BoardSmith Theme System
 *
 * Allows games to customize colors via boardsmith.json theme config
 */

export interface ThemeConfig {
  /** Primary accent color */
  primaryColor?: string;
  /** Background color for game area */
  backgroundColor?: string;
  /** Text color */
  textColor?: string;
  /** Secondary accent color */
  secondaryColor?: string;
  /** Error/danger color */
  errorColor?: string;
  /** Success color */
  successColor?: string;
}

const defaultTheme: Required<ThemeConfig> = {
  primaryColor: '#4a90d9',
  backgroundColor: '#f5f5f5',
  textColor: '#1a1a2e',
  secondaryColor: '#6c757d',
  errorColor: '#dc2626',
  successColor: '#4ade80',
};

/**
 * Apply theme CSS variables to document root
 */
export function applyTheme(config: ThemeConfig = {}): void {
  const theme = { ...defaultTheme, ...config };
  const root = document.documentElement;

  root.style.setProperty('--bsg-primary', theme.primaryColor);
  root.style.setProperty('--bsg-background', theme.backgroundColor);
  root.style.setProperty('--bsg-text', theme.textColor);
  root.style.setProperty('--bsg-secondary', theme.secondaryColor);
  root.style.setProperty('--bsg-error', theme.errorColor);
  root.style.setProperty('--bsg-success', theme.successColor);

  // Generate derived colors
  root.style.setProperty('--bsg-primary-light', lighten(theme.primaryColor, 0.2));
  root.style.setProperty('--bsg-primary-dark', darken(theme.primaryColor, 0.2));
}

/**
 * Get current theme values
 */
export function getTheme(): Required<ThemeConfig> {
  const root = document.documentElement;
  const style = getComputedStyle(root);

  return {
    primaryColor: style.getPropertyValue('--bsg-primary').trim() || defaultTheme.primaryColor,
    backgroundColor: style.getPropertyValue('--bsg-background').trim() || defaultTheme.backgroundColor,
    textColor: style.getPropertyValue('--bsg-text').trim() || defaultTheme.textColor,
    secondaryColor: style.getPropertyValue('--bsg-secondary').trim() || defaultTheme.secondaryColor,
    errorColor: style.getPropertyValue('--bsg-error').trim() || defaultTheme.errorColor,
    successColor: style.getPropertyValue('--bsg-success').trim() || defaultTheme.successColor,
  };
}

// Color manipulation helpers
function lighten(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  return rgbToHex(
    Math.min(255, Math.round(rgb.r + (255 - rgb.r) * amount)),
    Math.min(255, Math.round(rgb.g + (255 - rgb.g) * amount)),
    Math.min(255, Math.round(rgb.b + (255 - rgb.b) * amount))
  );
}

function darken(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  return rgbToHex(
    Math.max(0, Math.round(rgb.r * (1 - amount))),
    Math.max(0, Math.round(rgb.g * (1 - amount))),
    Math.max(0, Math.round(rgb.b * (1 - amount)))
  );
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * CSS custom properties for use in components
 * Import this in your styles to use theme variables
 */
export const themeCSS = `
:root {
  --bsg-primary: ${defaultTheme.primaryColor};
  --bsg-primary-light: ${lighten(defaultTheme.primaryColor, 0.2)};
  --bsg-primary-dark: ${darken(defaultTheme.primaryColor, 0.2)};
  --bsg-background: ${defaultTheme.backgroundColor};
  --bsg-text: ${defaultTheme.textColor};
  --bsg-secondary: ${defaultTheme.secondaryColor};
  --bsg-error: ${defaultTheme.errorColor};
  --bsg-success: ${defaultTheme.successColor};
}
`;
