
export async function withRetries<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      if (e.message === 'Connection terminated unexpectedly') {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}