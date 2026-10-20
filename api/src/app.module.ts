import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { IncomingMessage } from 'node:http';
import { ClsModule } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';
import { AccountModule } from './account/account.module';
import { ActivityModule } from './activity/activity.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditInterceptor } from './activity/audit.interceptor';
import { AuthModule } from './auth/auth.module';
import { BranchesModule } from './branches/branches.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { AUTH_THROTTLE_KEY } from './common/decorators/auth-throttle.decorator';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { type Env, validateEnv } from './config/env';
import { HealthController } from './health/health.controller';
import { OdooModule } from './odoo/odoo.module';
import { OrdersModule } from './orders/orders.module';
import { PpfModule } from './ppf/ppf.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsModule } from './products/products.module';
import { PublicModule } from './public/public.module';
import { PermissionsGuard } from './rbac/permissions.guard';
import { RbacModule } from './rbac/rbac.module';
import { SalesAccessModule } from './sales-access/sales-access.module';
import { ReceiptsModule } from './receipts/receipts.module';
import { ReservationsModule } from './reservations/reservations.module';
import { ServicesModule } from './services/services.module';
import { ShopModule } from './shop/shop.module';
import { ShowroomModule } from './showroom/showroom.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';

type IdRequest = IncomingMessage & { id?: string };

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true, generateId: true, idGenerator: (req: IdRequest) => req.id ?? '' },
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          genReqId: (req: IdRequest) => req.id ?? '',
          redact: {
            paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
            censor: '[redacted]',
          },
          serializers: {
            req: (req: { id: string; method: string; url: string; remoteAddress?: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
              ip: req.remoteAddress,
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          autoLogging: { ignore: (req: IncomingMessage) => req.url === '/api/health' },
          ...(config.get('NODE_ENV', { infer: true }) === 'development'
            ? { transport: { target: 'pino-pretty', options: { singleLine: true, colorize: true } } }
            : {}),
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        // limits are read per request so they follow runtime config changes
        throttlers: [
          { name: 'default', ttl: 60_000, limit: () => config.get('RATE_LIMIT_PER_MINUTE', { infer: true }) },
          {
            name: 'auth',
            ttl: () => config.get('AUTH_THROTTLE_TTL_SECONDS', { infer: true }) * 1000,
            limit: () => config.get('AUTH_THROTTLE_LIMIT', { infer: true }),
            skipIf: (ctx) => Reflect.getMetadata(AUTH_THROTTLE_KEY, ctx.getHandler()) !== true,
          },
        ],
      }),
    }),
    PrismaModule,
    ActivityModule,
    AuthModule,
    AccountModule,
    RbacModule,
    UsersModule,
    BranchesModule,
    UploadsModule,
    ProductsModule,
    OdooModule,
    ServicesModule,
    ShowroomModule,
    OrdersModule,
    PpfModule,
    SalesAccessModule,
    ReservationsModule,
    ReceiptsModule,
    PublicModule,
    ShopModule,
    AnalyticsModule,
  ],
  controllers: [HealthController],
  providers: [
    // order matters: rate limit → authenticate → authorize
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
