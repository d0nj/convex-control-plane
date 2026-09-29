/**
 * PostCSS pipeline for the web app.
 *
 * Tailwind v4 ships as a PostCSS plugin (`@tailwindcss/postcss`) — there is no
 * `tailwind.config.js` and no `tailwindcss` plugin entry any more. The v4
 * contract is: this file registers the plugin, and `app/globals.css` opts in
 * with a single `@import "tailwindcss";` at the top. shadcn's CLI detects
 * Tailwind by that CSS entry, so this file is load-bearing for `shadcn init`.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
