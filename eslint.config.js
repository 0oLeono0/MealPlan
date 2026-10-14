import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import refresh from 'eslint-plugin-react-refresh';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'Documents/**', 'playwright-report/**', 'test-results/**', '.playwright-mcp/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/ui/**/*.tsx'],
    plugins: { 'react-hooks': hooks, 'react-refresh': refresh },
    rules: { ...hooks.configs.recommended.rules, 'react-refresh/only-export-components': 'error' },
  },
];
