import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './client.js';

// Prisma 7 uses driver adapters for the runtime connection. The URL is read from
// DATABASE_URL at construction time, so tests can point it at a Testcontainers
// instance by setting process.env.DATABASE_URL before this module is first imported.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
