export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/apps/server/tests', '<rootDir>/server/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: false,
    }],
  },
  testTimeout: 30000,
}