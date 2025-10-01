module.exports = {
  root: true,
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  env: { node: true, es2022: true, browser: true },
  rules: {
    'no-restricted-syntax': [
      'error',
      { 'selector': "Identifier[name='item']", 'message': "Use 'orderLine' not 'item'." }
    ]
  }
}