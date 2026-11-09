/**
 * Test environment. This file runs before every test module is imported, so the
 * values must be set directly on process.env — never from a .env file. Services
 * read credentials lazily through server/config.ts, which these stubs satisfy,
 * but no test ever contacts a real payment or messaging provider.
 */
process.env.NODE_ENV = 'test';
process.env.PORT = '4100';
process.env.DATABASE_URL = 'postgres://devrelay:test@127.0.0.1:6432/devrelay_test';
process.env.APP_ORIGIN = 'http://localhost:5173';
process.env.PUBLIC_API_URL = 'http://localhost:4000';
process.env.SESSION_SECRET = 'devrelay-test-session-secret-0123456789abcdef0123456789';
process.env.ENCRYPTION_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
process.env.EMAIL_MODE = 'console';
process.env.SUPPORT_EMAIL = 'support@devrelay.example';
process.env.AT_USERNAME = 'devrelay-sandbox';
process.env.AT_API_KEY = 'test-at-api-key-not-real';
process.env.AT_MODE = 'sandbox';
process.env.AT_CALLBACK_TOKEN = 'test-callback-token-not-real';
process.env.PAYSTACK_SECRET_KEY = 'sk_test_devrelay_stubs_only';
process.env.PAYSTACK_WEBHOOK_SECRET = 'test-paystack-webhook-secret';
process.env.META_APP_ID = '123456789012345';
process.env.META_APP_SECRET = 'test-meta-app-secret-not-real';
process.env.META_CONFIG_ID = '999888777666555';
process.env.META_VERIFY_TOKEN = 'test-meta-verify-token';
process.env.META_PRODUCTION_APPROVED = 'false';
