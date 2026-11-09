import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // Dinheiro passa por src/lib/money.ts: arredondamento feito à mão diverge em centavos.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "BinaryExpression[operator='/'][right.value=100][left.type='CallExpression'][left.callee.object.name='Math'][left.callee.property.name='round']",
          message: "Use round2/toCents/fromCents de '@/lib/money' em vez de Math.round(x * 100) / 100.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
