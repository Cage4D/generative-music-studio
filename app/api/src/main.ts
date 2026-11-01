console.info("[api] entrypoint loaded", { nodeVersion: process.version });

if (process.env.NODE_ENV !== "production") {
  await import("dotenv/config");
}

async function bootstrap() {
  let phase = "load-dependencies";
  try {
    const [{ NestFactory }, { AppModule }, config] = await Promise.all([
      import("@nestjs/core"),
      import("./app.module.js"),
      import("./config.js"),
    ]);
    console.info("[api] dependencies loaded");

    phase = "create-app";
    const app = await NestFactory.create(AppModule);
    console.info("[api] Nest application created");

    const origins = config.parseCorsOrigins(process.env.CORS_ORIGINS);
    app.enableCors({
      origin: origins,
      credentials: true,
      methods: ["GET", "POST", "OPTIONS"],
    });

    // Trust the Vercel/Render proxy hop so the rate limiter sees the real IP.
    app
      .getHttpAdapter()
      .getInstance()
      .set("trust proxy", config.parseTrustProxy(process.env.TRUST_PROXY));

    const port = config.parsePort(process.env.PORT);
    phase = "listen";
    await app.listen(port);
    console.info("[api] listener ready", { port });
  } catch (error) {
    console.error(`[api] bootstrap failed during ${phase}`, error);
    throw error;
  }
}
void bootstrap();
