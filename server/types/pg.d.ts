declare module "pg" {
  export type PoolConfig = {
    connectionString?: string;
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
    /** TLS options, passed to tls.connect (server/lib/dbConnection.ts forces it for Neon). */
    ssl?: boolean | { rejectUnauthorized?: boolean };
  };

  export type PoolClient = {
    query: (text: string, params?: unknown[]) => Promise<unknown>;
    release: () => void;
  };

  export class Pool {
    constructor(config?: PoolConfig);
    connect(): Promise<PoolClient>;
    query(text: string, params?: unknown[]): Promise<unknown>;
    on(event: "error", listener: (err: Error) => void): this;
  }
}
