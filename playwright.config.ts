import { defineConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: path.join(os.tmpdir(), 'lattice-playwright-results'),
  workers: 1,
  timeout: 60000,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
