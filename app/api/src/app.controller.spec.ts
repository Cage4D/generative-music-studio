import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;
  let appRef: TestingModule;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);

    appRef = app;
  });

  describe('root', () => {
    it('returns the greeting from AppService', () => {
      const service = appRef.get<AppService>(AppService);
      expect(appController.getHello()).toBe(service.getHello());
    });

    it('returns a non-empty greeting', () => {
      expect(appController.getHello()).toBeTruthy();
    });
  });

  describe('health', () => {
    it('reports ok', () => {
      expect(appController.health()).toEqual({ status: 'ok' });
    });
  });
});
