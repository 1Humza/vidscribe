import { defineConfig, devices } from '@playwright/test';
import {
  dataPath,
  destinationPath,
  sourcePath,
} from './tests/e2e/fixtures/media';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npx tsx tests/e2e/fixtures/start-backend.ts',
      url: 'http://127.0.0.1:8000/api/health',
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        VIDSCRIBE_HOST: '127.0.0.1',
        VIDSCRIBE_PORT: '8000',
        VIDSCRIBE_DATA_DIR: dataPath,
        VIDSCRIBE_TEST_MODE: '1',
        VIDSCRIBE_TEST_SOURCE_PATH: sourcePath,
        VIDSCRIBE_TEST_DESTINATION_PATH: destinationPath,
      },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5173',
      url: 'http://127.0.0.1:5173',
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        VITE_API_BASE_URL: '',
      },
    },
  ],
});
