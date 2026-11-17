import { z } from 'zod';

// Zod otherwise probes `new Function`, which the dashboard's Content Security Policy forbids. This
// module must be imported before any module that parses with zod.
z.config({ jitless: true });
