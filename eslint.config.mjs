import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', '.trellis/**', 'test/codex-asr/**', '.pi/extensions/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/main/ipc/registry.ts', 'src/renderer/src/lib/ipc-client.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': ['error', { ignoreRestArgs: true, fixToUnknown: false }],
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': ['warn', { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true }],
      'prefer-const': 'error',
      'no-empty': ['warn', { allowEmptyCatch: false }],
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'off',
    },
    plugins: { 'react-hooks': reactHooks },
  },
)