import { Module } from "@nestjs/common";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { PatternsModule } from "./patterns/patterns.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";

@Module({
  imports: [PrismaModule, PatternsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
