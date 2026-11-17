import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  integrations: [
    starlight({
      title: 'Pushlane',
      description: 'Register installations. Send to a user. Inspect every attempt.',
      customCss: ['./src/styles/custom.css'],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/yousefelassal/pushlane',
        },
      ],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Introduction', slug: '' },
            { label: 'Quickstart', slug: 'quickstart' },
          ],
        },
        { label: 'Integrate', autogenerate: { directory: 'guides' } },
        { label: 'Reference', autogenerate: { directory: 'reference' } },
      ],
    }),
  ],
});
