import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.vercel/**",
      "**/routeTree.gen.ts",
      "openapi/client/**",
      "packages/db/migrations/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["apps/api/**/*.ts", "packages/*/src/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    // Time discipline (arch D13, engineering rules §Time & locking): domain
    // logic reads "now" only through the injected Clock. SystemClock and tests
    // are the sanctioned exceptions below.
    files: ["apps/api/src/**/*.ts", "packages/*/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "Read time through the injected Clock (arch D13), not Date.now().",
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Read time through the injected Clock (arch D13), not new Date().",
        },
        {
          selector:
            "TaggedTemplateExpression[tag.name='sql'] TemplateElement[value.raw=/\\bnow\\s*\\(|current_timestamp|localtimestamp/i]",
          message:
            "Pass clock.now() to SQL as a bound parameter — never the database's own now() (arch D13).",
        },
      ],
    },
  },
  {
    // Drizzle column builders: .defaultNow() would bake SQL now() into schema.
    files: ["packages/db/src/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='defaultNow']",
          message: "No defaultNow() — timestamps are written explicitly from the Clock (arch D13).",
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: "Read time through the injected Clock (arch D13), not Date.now().",
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: "Read time through the injected Clock (arch D13), not new Date().",
        },
      ],
    },
  },
  prettier,
);
