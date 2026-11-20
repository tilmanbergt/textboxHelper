// Layers (DEVELOPMENT-POLICY §3, design-overview §3): what each folder under src/ may import.
// No screen scrolls (DEVELOPMENT-POLICY §4): long content pages instead. Part of every layer rule
// below, because an override's no-restricted-imports replaces the top-level one.
const NO_SCROLL = {
  name: 'react-native',
  importNames: ['ScrollView', 'FlatList', 'SectionList'],
  message: 'Page instead of scrolling: ui/PagedSection for lists, ui/PagedText for long text.',
};
const layer = (forbidden, message) => ({
  'no-restricted-imports': ['error', {paths: [NO_SCROLL], patterns: [{group: forbidden, message}]}],
});
const RN_AND_SDK = ['react', 'react-native', 'react-native-*', '@react-native*/**', 'sn-plugin-lib'];

module.exports = {
  root: true,
  extends: '@react-native',
  ignorePatterns: ['build/', 'src/ui/generated/'],
  rules: {
    // `void promise` marks a deliberate fire-and-forget call (same rule as Kept GTD).
    'no-void': ['warn', {allowAsStatement: true}],
    'no-restricted-imports': ['error', {paths: [NO_SCROLL]}],
  },
  overrides: [
    {
      files: ['src/domain/**'],
      rules: layer(
        [...RN_AND_SDK, '**/storage/**', '**/supernote/**', '**/actions/**', '**/ui/**', '**/screens/**', '**/utils/**'],
        'domain/ is pure: no React Native, no sn-plugin-lib, no I/O, no imports from the other layers.',
      ),
    },
    {
      files: ['src/utils/**'],
      rules: layer(
        ['**/storage/**', '**/supernote/**', '**/actions/**', '**/ui/**', '**/screens/**'],
        'utils/ stands below every other layer.',
      ),
    },
    {
      files: ['src/supernote/**'],
      rules: layer(
        ['**/storage/**', '**/actions/**', '**/ui/**', '**/screens/**'],
        'supernote/ wraps the device; it never reaches up into storage, actions or UI.',
      ),
    },
    {
      files: ['src/storage/**'],
      rules: layer(['**/actions/**', '**/ui/**', '**/screens/**'], 'storage/ is file I/O; it never imports actions or UI.'),
    },
    {
      files: ['src/actions/**'],
      rules: layer(['**/ui/**', '**/screens/**'], 'actions/ never imports from ui/ or screens/.'),
    },
    {
      files: ['src/ui/**'],
      rules: layer(['**/screens/**'], 'ui/ holds shared building blocks; screens import them, not the other way round.'),
    },
  ],
};
