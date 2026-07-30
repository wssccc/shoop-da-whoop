// PostCSS pipeline.
// postcss-preset-env already bundles autoprefixer, so we do NOT add it twice.
// `stage: 3` enables features that are shipping in real browsers but not yet
// in the CSS spec "officially". `inset`, `gap` fallback generation is handled
// here when a polyfill-style rewrite is possible.
//
// NOTE: flex `gap` has NO equivalent in old Safari (it requires the engine
// itself). postcss-preset-env cannot polyfill it. We rely on the layout staying
// usable; if pixel-perfect spacing is required on iOS 13, replace flex `gap`
// in css/style.css with margin-based spacing + a negative-margin wrapper.
import postcssPresetEnv from 'postcss-preset-env';
import tailwindcss from 'tailwindcss';

export default {
  plugins: [
    // Tailwind handles the Othello stylesheet (`@tailwind` directives in
    // games/othello/src/index.css). CSS without `@tailwind` is passed through
    // untouched, so home / solitaire / 1a2b styles are unaffected. Run it
    // first so postcss-preset-env can downgrade its output for legacy browsers.
    tailwindcss(),
    postcssPresetEnv({
      stage: 3,
      // Keep nesting off — the stylesheet doesn't use native nesting,
      // disabling it speeds up the transform and avoids surprises.
      features: {
        'nesting-rules': false,
      },
    }),
  ],
};
