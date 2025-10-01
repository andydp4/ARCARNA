export default {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/apps/web/tests'],
  setupFilesAfterEnv: ['@testing-library/jest-dom']
}