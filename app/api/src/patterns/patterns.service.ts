import { randomInt } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import type { CreatePatternInput, GalleryQuery, Pattern } from "@gms/shared";
import { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { decodeCursor, encodeCursor, type Cursor } from "./cursor.js";

const SLUG_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const SLUG_LENGTH = 10;
const MAX_SLUG_ATTEMPTS = 5;

function makeSlug(): string {
  let slug = "";
  for (let i = 0; i < SLUG_LENGTH; i++) {
    slug += SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)];
  }
  return slug;
}

const withParent = {
  parent: { select: { slug: true } },
} satisfies Prisma.PatternInclude;

type PatternRow = Prisma.PatternGetPayload<{ include: typeof withParent }>;

function toResponse(row: PatternRow) {
  return {
    slug: row.slug,
    title: row.title,
    pattern: {
      generatorId: row.generatorId,
      params: row.params,
    } as unknown as Pattern, // trusted: validated with PatternSchema before it was stored
    playCount: row.playCount,
    remixCount: row.remixCount,
    parentSlug: row.parent?.slug ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function keysetWhere(cursor: Cursor): Prisma.PatternWhereInput {
  if (cursor.sort === "recent") {
    const createdAt = new Date(cursor.createdAt);
    return {
      OR: [
        { createdAt: { lt: createdAt } },
        { createdAt, id: { lt: cursor.id } },
      ],
    };
  }
  return {
    OR: [
      { playCount: { lt: cursor.playCount } },
      { playCount: cursor.playCount, id: { lt: cursor.id } },
    ],
  };
}

@Injectable()
export class PatternsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreatePatternInput) {
    const { pattern, title, parentSlug } = input;

    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
      try {
        const row = await this.prisma.$transaction(async (tx) => {
          let parentId: string | undefined;

          if (parentSlug) {
            const parent = await tx.pattern.findUnique({
              where: { slug: parentSlug },
              select: { id: true },
            });
            if (!parent) {
              throw new NotFoundException(
                `Parent pattern "${parentSlug}" not found`,
              );
            }
            parentId = parent.id;
          }

          const created = await tx.pattern.create({
            data: {
              slug: makeSlug(),
              title,
              generatorId: pattern.generatorId,
              params: pattern.params as Prisma.InputJsonValue,
              parentId,
            },
            include: withParent,
          });

          if (parentId) {
            await tx.pattern.update({
              where: { id: parentId },
              data: { remixCount: { increment: 1 } },
            });
          }

          return created;
        });

        return toResponse(row);
      } catch (e) {
        const isUniqueViolation =
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002";
        if (isUniqueViolation) continue;
        throw e;
      }
    }

    throw new InternalServerErrorException("Could not allocate a unique slug");
  }

  async findAll(query: GalleryQuery) {
    const { sort, limit } = query;

    let cursor: Cursor | null = null;
    if (query.cursor) {
      cursor = decodeCursor(query.cursor);
      if (!cursor || cursor.sort !== sort) {
        throw new BadRequestException("Invalid cursor");
      }
    }

    const rows = await this.prisma.pattern.findMany({
      where: { isPublic: true, ...(cursor ? keysetWhere(cursor) : {}) },
      orderBy:
        sort === "recent"
          ? [{ createdAt: "desc" }, { id: "desc" }]
          : [{ playCount: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: withParent,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    let nextCursor: string | null = null;
    if (hasMore && last) {
      nextCursor = encodeCursor(
        sort === "recent"
          ? { sort, createdAt: last.createdAt.toISOString(), id: last.id }
          : { sort, playCount: last.playCount, id: last.id },
      );
    }

    return { items: page.map(toResponse), nextCursor };
  }

  async findBySlug(slug: string) {
    const row = await this.prisma.pattern.findUnique({
      where: { slug },
      include: withParent,
    });
    if (!row) {
      throw new NotFoundException(`Pattern "${slug}" not found`);
    }
    return toResponse(row);
  }
}