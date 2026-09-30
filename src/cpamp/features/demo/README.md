Only `demoMode.ts` and `demoFixtures.empty.ts` are ported (unchanged) so that
`services/api/models.ts` stays verbatim. `__DEMO_SITE__` is defined as `false` in
vite.config.ts, so demo code paths are dead and tree-shaken in production.
