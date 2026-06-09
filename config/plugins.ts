import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  i18n: {
    enabled: true,
    config: {
      defaultLocale: 'en',
      locales: ['en', 'ar'],
    },
  },
});

export default config;
