// MeridianOS ESLint flat config (ES modules, Node.js)
// Run: npm run lint  (add "lint": "eslint ." to package.json scripts)

export default [
  {
    ignores: [
      "node_modules/**",
      ".ai/**",
      "**/*.db",
      "**/*.sqlite",
      "coverage/**",
      "dist/**",
      "*.min.js"
    ]
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly"
      }
    },
    rules: {
      // ES module enforcement — reject CommonJS patterns
      "no-restricted-imports": ["error", {
        patterns: ["require"]
      }],
      "no-restricted-modules": ["error", {
        paths: ["module"]
      }],
      // Syntax rules
      "no-var": "error",
      "prefer-const": "error",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // Style
      "semi": ["error", "always"],
      "quotes": ["error", "double", { avoidEscape: true }],
      "comma-dangle": ["error", "always-multiline"],
      "eol-last": ["error", "always"],
      "no-trailing-spaces": "error",
      "no-multiple-empty-lines": ["error", { max: 1 }],
      // Best practices
      "eqeqeq": ["error", "always"],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error"
    }
  },
  {
    files: ["**/*.test.mjs", "**/*.test.js", "tests/**/*.mjs", "test/**/*.mjs"],
    rules: {
      "no-console": "off",
      "no-unused-vars": "off"
    }
  }
];
