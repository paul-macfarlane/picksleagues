import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  beforeSend(event) {
    // Filter out expected AppError subclasses
    const message = event.exception?.values?.[0]?.value;
    if (
      message &&
      /Unauthorized|Forbidden|Not found|Bad request/i.test(message)
    ) {
      return null;
    }
    return event;
  },
});
