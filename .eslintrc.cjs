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
  ],
  overrides: [
    {
      files: ["client/src/components/CommandPalette.tsx"],
      rules: { "no-restricted-syntax": "off" },
    },
    {
      // The `item` ban below is a DOMAIN vocabulary rule: an order line should be
      // called `orderLine`. These files have nothing to do with orders, and
      // `item` is the correct name in each — so the rule was reporting 163
      // errors that were all false, and `npm run lint` reported 194 problems of
      // which only ~30 were real defects. A linter nobody can act on is a
      // linter nobody reads, and the 29 genuine a11y errors were buried in it.
      //
      //   components/ui/**  vendored shadcn/ui. `item` there is Recharts'
      //                     payload item and Radix's menu/select item — third-
      //                     party contracts, renaming them breaks the component.
      //   chart.tsx alone accounted for 25.
      files: [
        "client/src/components/ui/**",
        "client/src/components/activity-timeline.tsx",
        "client/src/components/settings/WhatsAppSettings.tsx",
      ],
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
