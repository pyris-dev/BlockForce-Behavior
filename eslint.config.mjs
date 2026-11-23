import tseslint from "typescript-eslint";
import minecraftIsValid from "eslint-plugin-minecraft-isvalid";

export default tseslint.config(
  {
    ignores: ["scripts/**", "dist/**", "**/node_modules/**"]
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  minecraftIsValid.configs.recommended,
  {
    files: ["utils/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "minecraft-isvalid/require-is-valid-check": "off",
      "minecraft-isvalid/require-chunk-loaded-check": "off",
      "minecraft-isvalid/no-unnecessary-is-valid-check": "off",
      "minecraft-isvalid/require-execution-privilege": "off",
      "minecraft-isvalid/require-is-valid-call-check": "off"
    }
  }
);
