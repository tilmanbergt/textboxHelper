module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // `void promise` marks a deliberate fire-and-forget call (same rule as Kept GTD).
    'no-void': ['warn', {allowAsStatement: true}],
  },
};
