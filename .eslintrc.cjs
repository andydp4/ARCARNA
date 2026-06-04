module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  env: { node: true, es2022: true, browser: true },
  plugins: ["jsx-a11y"],
  extends: ["plugin:jsx-a11y/recommended"],
  settings: { react: { version: "detect" } },
  ignorePatterns: [
    "dist/**",
    "node_modules/**",
    "portal/**",
    "client/src/pages/pos.tsx",
    "client/src/pages/pos/**",
    "client/src/components/pos-*.tsx",
  ],
  overrides: [
    {
      files: ["client/src/components/CommandPalette.tsx"],
      rules: { "no-restricted-syntax": "off" },
    },
  ],
  rules: {
    "no-restricted-syntax": [
      "error",
      { selector: "Identifier[name='item']", message: "Use 'orderLine' not 'item'." },
    ],
    "jsx-a11y/anchor-is-valid": "warn",
    "jsx-a11y/click-events-have-key-events": "warn",
    "jsx-a11y/no-static-element-interactions": "warn",
  },
};
