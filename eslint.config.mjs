import globals from 'globals'
import pluginJs from '@eslint/js'

export default [
	{
    files: ['**/*.js'],
    languageOptions: { sourceType: 'module', globals: globals.node },
  },
	{
    languageOptions: { sourceType: 'module', globals: globals.browser }
  },
	pluginJs.configs.recommended,
]
