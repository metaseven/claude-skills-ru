import { defineConfig } from 'astro/config';

// В GitHub Actions SITE_URL и BASE_PATH приходят из actions/configure-pages,
// поэтому имя репозитория нигде не захардкожено.
export default defineConfig({
  site: process.env.SITE_URL ?? 'http://localhost:4321',
  base: process.env.BASE_PATH ?? '/',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
