// Deterministic, non-production defaults for every test run.
//
// Secrets are set here so unit tests exercise the real derivation paths rather
// than a bypass. Anything asserting fail-closed behaviour must unset them
// locally within its own test.
process.env.AYA_ENV = 'test'
process.env.AYA_FLAG_SECRET ??= 'test-flag-secret-not-for-production'
process.env.AYA_AUTH_SECRET ??= 'test-auth-secret-not-for-production'
process.env.MIDTRANS_SERVER_KEY ??= 'SB-Mid-server-TESTKEY'
process.env.MIDTRANS_CLIENT_KEY ??= 'SB-Mid-client-TESTKEY'
process.env.AYA_RUNNER ??= 'stub'
// Retry immediately: the backoff is production behaviour, not something a test
// should spend wall-clock seconds proving.
process.env.AYA_FULFILL_RETRY_BASE_MS ??= '0'
