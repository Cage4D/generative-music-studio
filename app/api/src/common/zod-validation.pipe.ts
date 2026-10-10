import {
  BadRequestException,
  Injectable,
  type PipeTransform,
} from "@nestjs/common";
import type { z } from "zod";

@Injectable()
export class ZodValidationPipe<S extends z.ZodType>
  implements PipeTransform<unknown, z.output<S>>
{
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        statusCode: 400,
        error: "ValidationError",
        message: "Request validation failed",
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join("."),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}