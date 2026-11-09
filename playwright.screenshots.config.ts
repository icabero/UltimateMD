import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Writes the screenshots of site/img from the real interface.
export default defineConfig({ ...base, testIgnore: undefined, testMatch: 'screenshots.spec.ts', workers: 1 });
