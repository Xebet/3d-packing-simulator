'use strict';

// Apply the saved theme before styles and the first paint; storage may be blocked.
try {
    document.documentElement.classList.toggle('light-theme', localStorage.getItem('packing_theme') !== 'dark');
} catch {
    document.documentElement.classList.add('light-theme');
}
