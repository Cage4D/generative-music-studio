import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { parseCorsOrigins, parsePort, parseTrustProxy } from "./config.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const origins = parseCorsOrigins(process.env.CORS_ORIGINS);
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
  });

  // The service runs behind Render (and optionally a CDN). Trusting the proxy
  // hop makes `request.ip` the real client IP, which is what the rate limiter
  // keys on.
  app.getHttpAdapter().getInstance().set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));

  const port = parsePort(process.env.PORT);
  await app.listen(port, "0.0.0.0");
  console.log(`API listening on 0.0.0.0:${port} (cors: ${origins.join(", ")})`);
}
await bootstrap();
