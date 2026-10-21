import { Injectable, type OnModuleInit } from "@nestjs/common";
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
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set. Did you create api/.env?");
    }
    super({
      adapter: new PrismaPg({
        connectionString: sanitizeConnectionString(connectionString),
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }
}
