// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'src/shared/vendor/*.js'],
  },
  {
    // Widths come from src/layout: on a Surface Duo the app has one screen, not the window.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/layout/**'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{
          name: 'react-native',
          importNames: ['useWindowDimensions', 'Dimensions'],
          message: 'Read widths with the hooks in @/layout/size (useAreaWidth, useWorkspaceWidth, useLayoutClass): on a Surface Duo the app has one screen, not the window.',
        }],
      }],
    },
  },
  {
    // On a Surface Duo the screen in front is the right one: router.setParams would change it from the left screen too.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-properties': ['error', {
        object: 'router',
        property: 'setParams',
        message: "Use the screen's own useNavigation().setParams: router.setParams changes the screen in front, which on a Surface Duo is the right screen even when the left one asks.",
      }],
    },
  },
]);
