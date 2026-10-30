import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

/**
 * Hosted Postgres providers (Neon) hand out connection strings that may
 * include `channel_binding=require`. The Prisma CLI understands that flag but
 * the `pg` driver passes unknown parameters straight to the server, which
 * then refuses the connection, so it is stripped here.
 */
export function sanitizeConnectionString(connectionString: string): string {
  if (!connectionString.includes("channel_binding")) return connectionString;
  try {
    const url = new URL(connectionString);
    url.searchParams.delete("channel_binding");
    return url.toString();
  } catch {
    return connectionString;
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);
  private readonly connectionString: string | undefined;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    super({
      adapter: new PrismaPg({
        connectionString: sanitizeConnectionString(connectionString ?? ""),
      }),
    });
    this.connectionString = connectionString;
    if (!connectionString) {
      this.logger.error(
        "DATABASE_URL is not set. Database-backed endpoints will be unavailable.",
      );
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.connectionString) return;
    try {
      await this.$connect();
    } catch (error) {
      this.logger.error(
        `Failed to connect to the database: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
