import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './common/prisma.service';
import { S3StorageService } from './storage/s3-storage.service';
import { AgentModule } from './agent/agent.module';
import { StorageController } from './storage/storage.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Делает ConfigModule доступным во всех модулях
    }),
    AgentModule,
  ],
  controllers: [AppController, StorageController],
  providers: [AppService, PrismaService, S3StorageService],
  exports: [S3StorageService], // Экспортируем для использования в других модулях
})
export class AppModule {}
