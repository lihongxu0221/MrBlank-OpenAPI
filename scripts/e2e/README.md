# Providers page E2E (local throwaway CPA only)

1. Start a throwaway CPA (e.g. binary copied from `eceasy/cli-proxy-api:v8.0.4`) on `127.0.0.1:18417`
   with a temp legacy-layout config whose `remote-management.secret-key` is `local-test-mgmt-key`
   and which contains unknown top-level keys (e.g. `x-mrblank-unknown-top`).
2. `CPA_MANAGEMENT_KEY=local-test-mgmt-key node scripts/e2e/cpaMgmtHarness.js` (real BFF router, stub admin guard, refuses non-local CPA).
3. `npx vite --port 5288 --host 127.0.0.1`
4. `W=1600 node scripts/e2e/providers-ui-e2e.mjs` (needs `playwright-core` resolvable + `/usr/bin/google-chrome`).

The script drives the ported UI: add → edit → inline priority → toggle → OpenAI-compat edit → two-step delete,
and after each step asserts that every other section / entry / non-provider config key is unchanged
and that unknown top-level YAML keys survive.

Note: CPA itself discards YAML-only keys inside provider *entries* on any config write (it never exposes
them via the management API), so those cannot be preserved by any management client (CPAMP included).
