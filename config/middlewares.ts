import type { Core } from '@strapi/strapi';

// Browser-side calls come from the deployed frontend (the site is a static
// export, so every CMS request is a cross-origin request from the visitor's
// browser). Any origin serving the site must be listed here or the preflight
// fails with "No 'Access-Control-Allow-Origin' header".
//
// CORS_ORIGINS is a comma-separated list, so adding a domain is an env change
// on Strapi Cloud rather than a redeploy of this file.
const DEFAULT_ORIGINS = [
  'https://nexus-properties.amxr.site',
  'https://nexus-properties-lilac.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://localhost:1337',
];

// Suffix rules for domains we control, where the exact host varies: Vercel
// mints a fresh preview domain per deployment, and amxr.site subdomains are
// added per project. Both cover the apex and any single-label subdomain.
const ALLOWED_HOST_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/i,
  /^https:\/\/([a-z0-9-]+\.)*amxr\.site$/i,
];

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Middlewares => [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          'img-src': ["'self'", 'data:', 'blob:', 'res.cloudinary.com'],
          'media-src': ["'self'", 'data:', 'blob:'],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  {
    name: 'strapi::cors',
    config: {
      enabled: true,
      headers: '*',
      // Exact matches come from CORS_ORIGINS; hosts on domains we control are
      // matched by pattern rather than by an exact-string list that would go
      // stale on every Vercel preview or new amxr.site subdomain.
      // Returning '' (not false) is how Strapi's cors middleware signals a
      // failed check: the callback is typed `string | string[]`.
      origin: (ctx: { request: { header: { origin?: string } } }): string => {
        const allowed = env.array('CORS_ORIGINS', DEFAULT_ORIGINS) as string[];
        const origin = ctx.request.header.origin;
        if (!origin) return '';
        if (allowed.includes(origin)) return origin;
        if (ALLOWED_HOST_PATTERNS.some((pattern) => pattern.test(origin))) return origin;
        return '';
      },
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];

export default config;
