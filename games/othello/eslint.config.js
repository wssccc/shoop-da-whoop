import js from '@eslint/js';
import compat from 'eslint-plugin-compat';
import pluginVue from 'eslint-plugin-vue';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';

export default defineConfig([
  globalIgnores(['dist']),
  // browserslist-aware compatibility gate — shares .browserslistrc with the
  // root eslint.config.js so the iOS 13 / Safari 13 floor is enforced here too
  // (flat configs do not cascade, so Othello's subtree would otherwise bypass
  // the root gate).
  compat.configs['flat/recommended'],
  {
    files: ['**/*.{ts,vue}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      pluginVue.configs['flat/recommended'],
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        sourceType: 'module',
      },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
]);
