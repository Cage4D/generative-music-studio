import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import {
  CreatePatternSchema,
  GalleryQuerySchema,
  type CreatePatternInput,
  type GalleryQuery,
} from "@gms/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { PatternsService } from "./patterns.service.js";

@Controller("patterns")
export class PatternsController {
  constructor(private readonly patternsService: PatternsService) {}

  @Post()
  create(
    @Body(new ZodValidationPipe(CreatePatternSchema)) body: CreatePatternInput,
  ) {
    return this.patternsService.create(body);
  }

  @Get()
  findAll(
    @Query(new ZodValidationPipe(GalleryQuerySchema)) query: GalleryQuery,
  ) {
    return this.patternsService.findAll(query);
  }

  @Get(":slug")
  findOne(@Param("slug") slug: string) {
    return this.patternsService.findBySlug(slug);
  }
}