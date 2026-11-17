// @ts-check

const codeImports = [
  '<BUILTIN_MODULES>',
  '<THIRD_PARTY_MODULES>',
  '',
  '^(@pushlane)(\\/.*)$',
  '',
  '^[.]{2}$',
  '^[.]{2}\\/',
  '^[.]\\/(?!index)',
  '^[.]$',
  '^[.]\\/index$',
  '',
];

// Type imports follow the same order without separators. The catch-all <TYPES> keeps the plugin from failing.
const typeImports = ['<TYPES>'].concat(
  codeImports.filter((i) => i !== '').map((i) => `<TYPES>${i}`)
);

/** @type {import("prettier").Config} */
const config = {
  trailingComma: 'es5',
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  printWidth: 100,
  plugins: ['@ianvs/prettier-plugin-sort-imports', 'prettier-plugin-packagejson'],
  importOrder: [...codeImports, ...typeImports],
  importOrderParserPlugins: ['typescript', 'jsx', 'decorators-legacy'],
  importOrderTypeScriptVersion: '5.9.3',
  overrides: [
    {
      files: ['*.jsonc', '*.code-workspace'],
      options: {
        trailingComma: 'none',
      },
    },
  ],
};

module.exports = config;
