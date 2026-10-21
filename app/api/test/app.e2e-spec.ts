import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { App } from "supertest/types.js";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

const arpeggioPattern = {
  generatorId: "arpeggio",
  params: {
    seed: 1,
    tempo: 120,
    root: "C",
    scale: "major",
    density: 0.5,
    swing: 0.2,
    effects: {},
    arpeggio: { pattern: "up", octaves: 2, stepLength: "8n" },
  },
};

const melodyPattern = {
  generatorId: "melody",
  params: {
    seed: 2,
    tempo: 120,
    root: "A",
    scale: "minor",
    density: 0.4,
    swing: 0,
    effects: {},
    melody: {
      waveform: "sine",
      contour: "wave",
      octaveRange: 2,
      noteLength: "4n",
      restProbability: 0.1,
      leapiness: 0.2,
      phraseLengthBars: 2,
    },
  },
};

const SLUG_RE = /^[abcdefghijkmnpqrstuvwxyz23456789]{10}$/;

describe("Patterns (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.pattern.deleteMany();
  });

  beforeEach(async () => {
    await prisma.pattern.deleteMany();
  });

  afterAll(async () => {
    await prisma.pattern.deleteMany();
    await app.close();
  });

  it("GET / returns the greeting", () => {
    return request(app.getHttpServer()).get("/").expect(200);
  });

  it("GET /health reports ok", async () => {
    const res = await request(app.getHttpServer()).get("/health").expect(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("POST /patterns rejects an invalid body with 400", () => {
    return request(app.getHttpServer())
      .post("/patterns")
      .send({ title: "Boom", pattern: { generatorId: "nope", params: {} } })
      .expect(400);
  });

  it("POST /patterns creates a pattern and returns it", async () => {
    const res = await request(app.getHttpServer())
      .post("/patterns")
      .send({ title: "E2E Arp", pattern: arpeggioPattern })
      .expect(201);

    expect(res.body.slug).toMatch(SLUG_RE);
    expect(res.body.title).toBe("E2E Arp");
    expect(res.body.pattern.generatorId).toBe("arpeggio");
    expect(res.body.pattern.params).toEqual(arpeggioPattern.params);
    expect(res.body.parentSlug).toBeNull();
    expect(res.body.playCount).toBe(0);
    expect(res.body.remixCount).toBe(0);
  });

  it("POST /patterns with an unknown parentSlug returns 404", async () => {
    await request(app.getHttpServer())
      .post("/patterns")
      .send({ parentSlug: "doesnotexist", pattern: arpeggioPattern })
      .expect(404);
  });

  it("POST /patterns with a parentSlug links the remix and bumps remixCount", async () => {
    const parent = await request(app.getHttpServer())
      .post("/patterns")
      .send({ title: "Original", pattern: arpeggioPattern })
      .expect(201);

    const remix = await request(app.getHttpServer())
      .post("/patterns")
      .send({
        title: "Remix",
        parentSlug: parent.body.slug,
        pattern: melodyPattern,
      })
      .expect(201);

    expect(remix.body.parentSlug).toBe(parent.body.slug);
    expect(remix.body.pattern.generatorId).toBe("melody");

    const refreshedParent = await request(app.getHttpServer())
      .get(`/patterns/${parent.body.slug}`)
      .expect(200);
    expect(refreshedParent.body.remixCount).toBe(1);
  });

  it("GET /patterns returns a paginated gallery", async () => {
    await Promise.all([
      request(app.getHttpServer())
        .post("/patterns")
        .send({ title: "One", pattern: arpeggioPattern }),
      request(app.getHttpServer())
        .post("/patterns")
        .send({ title: "Two", pattern: melodyPattern }),
      request(app.getHttpServer())
        .post("/patterns")
        .send({ title: "Three", pattern: arpeggioPattern }),
    ]);

    const first = await request(app.getHttpServer())
      .get("/patterns?limit=2")
      .expect(200);

    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await request(app.getHttpServer())
      .get(`/patterns?limit=2&cursor=${first.body.nextCursor}`)
      .expect(200);

    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();

    const slugs = [
      ...first.body.items.map((i: { slug: string }) => i.slug),
      ...second.body.items.map((i: { slug: string }) => i.slug),
    ];
    expect(new Set(slugs).size).toBe(3);
  });

  it("GET /patterns/:slug returns a single pattern", async () => {
    const created = await request(app.getHttpServer())
      .post("/patterns")
      .send({ title: "Single", pattern: arpeggioPattern })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/patterns/${created.body.slug}`)
      .expect(200);
    expect(res.body.title).toBe("Single");
  });

  it("GET /patterns/:slug returns 404 for an unknown slug", () => {
    return request(app.getHttpServer())
      .get("/patterns/doesnotexist")
      .expect(404);
  });
});