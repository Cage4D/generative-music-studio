import { Module } from "@nestjs/common";
import { PatternsController } from "./patterns.controller.js";
import { PatternsService } from "./patterns.service.js";

@Module({
  controllers: [PatternsController],
  providers: [PatternsService],
})
export class PatternsModule {}
