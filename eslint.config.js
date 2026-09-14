import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'public/data', 'coverage'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        history: 'readonly',
        fetch: 'readonly',
        console: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        queueMicrotask: 'readonly',
        matchMedia: 'readonly',
        ResizeObserver: 'readonly',
        IntersectionObserver: 'readonly',
        WebSocket: 'readonly',
        Worker: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        HTMLElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLDivElement: 'readonly',
        HTMLButtonElement: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        PointerEvent: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        AbortController: 'readonly',
        structuredClone: 'readonly',
      },
    },
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // Kaydırılabilir bir bölge klavyeyle de erişilebilir OLMALIDIR (WCAG 2.1.1);
      // kuralın varsayılanı yalnızca tabpanel'e izin verdiği için region eklendi.
      'jsx-a11y/no-noninteractive-tabindex': [
        'error',
        { tags: [], roles: ['tabpanel', 'region'], allowExpressionValues: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },

  // --- core/ boundary: pure TypeScript only. No DOM, no React, no I/O.
  // This is what makes the analysis layer testable in Node and runnable in a
  // Worker. Breaking the boundary is a lint error, not a code-review opinion.
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...[
          'window',
          'document',
          'localStorage',
          'sessionStorage',
          'navigator',
          'location',
          'history',
          'fetch',
          'matchMedia',
          'requestAnimationFrame',
        ].map((name) => ({
          name,
          message: `core/ katmanı saf olmalı — "${name}" burada kullanılamaz (UI/veri katmanına taşı).`,
        })),
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*', 'lightweight-charts', '../ui/*', '../../ui/*'],
              message: 'core/ katmanı UI kütüphanelerine bağımlı olamaz.',
            },
          ],
        },
      ],
    },
  },

  // --- Devralınan ekranlar (Faz 2'de core/ + tasarım sistemine taşınacak).
  // Erişilebilirlik kuralları burada UYARI: yeni kodda hata olarak zorunlu,
  // eski kodda ise taşıma sırasında tek tek kapatılacak bir borç listesi.
  {
    files: ['src/App.tsx', 'src/components/**/*.tsx'],
    rules: Object.fromEntries(
      Object.keys(jsxA11y.flatConfigs.recommended.rules).map((rule) => [rule, 'warn']),
    ),
  },

  // Test files may reach for anything.
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: { 'no-restricted-globals': 'off', 'no-restricted-imports': 'off' },
  },

  // Node scripts.
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
    rules: { 'no-console': 'off' },
  },
);
