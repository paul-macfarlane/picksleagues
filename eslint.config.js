import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";

// Time discipline (arch D13, engineering rules §Time & locking): domain logic
// reads "now" only through the injected Clock. Kept as ONE selector list in ONE
// config block on purpose — in flat config a later block's rule entry REPLACES
// an earlier one's options (it does not merge), so splitting these across
// overlapping blocks silently drops selectors. SystemClock (inline disable) and
// tests are the sanctioned exceptions.
const timeDisciplineSelectors = [
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: "Read time through the injected Clock (arch D13), not Date.now().",
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: "Read time through the injected Clock (arch D13), not new Date().",
  },
  {
    selector: "CallExpression[callee.name='Date']",
    message:
      "Date() as a function returns the current time — read it through the Clock (arch D13).",
  },
  {
    selector:
      "TaggedTemplateExpression[tag.name='sql'] TemplateElement[value.raw=/\\bnow\\s*\\(|current_timestamp|localtimestamp/i]",
    message:
      "Pass clock.now() to SQL as a bound parameter — never the database's own now() (arch D13).",
  },
  {
    selector:
      "CallExpression[callee.object.name='sql'][callee.property.name='raw'] Literal[value=/\\bnow\\s*\\(|current_timestamp|localtimestamp/i]",
    message:
      "Pass clock.now() to SQL as a bound parameter — never the database's own now() (arch D13).",
  },
  {
    selector: "CallExpression[callee.property.name='defaultNow']",
    message: "No defaultNow() — timestamps are written explicitly from the Clock (arch D13).",
  },
];

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.vercel/**",
      // Agent worktrees are nested checkouts of this same repo (CLAUDE.md puts
      // them here by convention). Without this, root `eslint .` sees two
      // candidate TSConfig roots and dies in the parser before any rule runs.
      ".claude/worktrees/**",
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
    files: ["apps/api/src/**/*.ts", "apps/api/scripts/**/*.ts", "packages/*/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...timeDisciplineSelectors],
    },
  },
  // Accretion guard (engineering rules §Architecture: a file that accretes
  // unrelated responsibilities gets split). A warning, not an error — the
  // number is a nudge to split along responsibilities at the moment growth
  // happens, not a hard cap to be gamed. Tests are exempt: table-driven
  // suites are legitimately long.
  {
    files: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.ts"],
    ignores: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "max-lines": ["warn", { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  prettier,
);
