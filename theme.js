'use strict';

const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
let themeMode = 'system';

// The new preference defaults to system instead of inheriting the old toggle.
try {
    const stored = localStorage.getItem('packing_theme_mode');
    if (stored === 'light' || stored === 'dark') themeMode = stored;
} catch { /* Storage restrictions still allow following the system. */ }

function applyTheme() {
    const isLight = themeMode === 'light' || (themeMode === 'system' && !systemThemeQuery.matches);
    document.documentElement.classList.toggle('light-theme', isLight);
}

applyTheme();
