import supertest from 'supertest';
import { buildApp } from '../../src/app.js';

export function agent() {
  return supertest(buildApp());
}
