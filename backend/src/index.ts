import 'dotenv/config';
import { buildApp } from './app.js';
import { getEnv } from './config/env.js';
import { logger } from './utils/logger.js';

const env = getEnv();
buildApp().listen(env.PORT, () => logger.info(`API on :${env.PORT}`));
