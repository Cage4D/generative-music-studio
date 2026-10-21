import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /** Liveness probe. Kept free of database calls so it stays fast. */
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }
}
