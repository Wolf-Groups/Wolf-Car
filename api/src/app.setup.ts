import { BadRequestException, INestApplication, ValidationError, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { corsOrigins, type Env } from './config/env';
import { CSRF_HEADER } from './auth/cookies';

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

function flattenValidationErrors(errors: ValidationError[], parent = ''): { field: string; messages: string[] }[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = e.constraints ? [{ field, messages: Object.values(e.constraints) }] : [];
    return [...own, ...flattenValidationErrors(e.children ?? [], field)];
  });
}

function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

/**
 * Global HTTP configuration shared by main.ts and the e2e tests, so tests run
 * against exactly the same middleware, pipes and security headers.
 */
export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  const config = app.get(ConfigService<Env, true>);

  express.set('trust proxy', parseTrustProxy(config.get('TRUST_PROXY', { infer: true })));
  express.disable('x-powered-by');

  // request id first, so logs, CLS and the audit log all share it
  express.use((req: Request & { id?: string }, res: Response, next: NextFunction) => {
    const incoming = req.headers['x-request-id'];
    req.id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  express.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: { 'img-src': ["'self'", 'data:'], 'frame-ancestors': ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  express.use(cookieParser());
  express.useBodyParser('json', { limit: '100kb' });
  express.useBodyParser('urlencoded', { limit: '100kb', extended: false });

  const allowlist = new Set(
    corsOrigins({ CORS_ORIGINS: config.get('CORS_ORIGINS', { infer: true }), NODE_ENV: config.get('NODE_ENV', { infer: true }) }),
  );
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) =>
      cb(null, !origin || allowlist.has(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id', CSRF_HEADER],
    exposedHeaders: ['X-Request-Id', 'Content-Disposition', 'Retry-After'],
    maxAge: 600,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: (errors) =>
        new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          code: 'VALIDATION_FAILED',
          message: 'Some fields are not valid.',
          errors: flattenValidationErrors(errors),
        }),
    }),
  );
  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED', { infer: true })) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Wolf Car API')
        .setDescription(
          'Multi-branch showroom ordering. Every route needs a dashboard access token unless marked public; ' +
            'showroom routes need a showroom access token. Permissions are listed on each route.',
        )
        .setVersion('1.0')
        .addBearerAuth()
        .addCookieAuth('wc_rt', { type: 'apiKey', in: 'cookie', name: 'wc_rt' }, 'wc_rt')
        .addCookieAuth('wc_srt', { type: 'apiKey', in: 'cookie', name: 'wc_srt' }, 'wc_srt')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs/openapi.json' });
  }
}
