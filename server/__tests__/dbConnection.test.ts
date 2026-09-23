import { describe, it, expect } from "vitest";
import { chooseDriver, sslFor } from "../lib/dbConnection";

describe("database driver choice", () => {
  it("uses node-postgres for every URL unless the Neon WebSocket driver is asked for", () => {
    expect(chooseDriver({})).toBe("node-postgres");
    expect(chooseDriver({ DB_DRIVER: "node-postgres" })).toBe("node-postgres");
    expect(chooseDriver({ DB_DRIVER: "neon" })).toBe("neon");
  });
});

describe("TLS for Neon over node-postgres", () => {
  it("forces verified TLS for a Neon URL without sslmode", () => {
    expect(sslFor("postgresql://u:p@ep-x-pooler.eu-west-2.aws.neon.tech/db")).toEqual({ rejectUnauthorized: true });
  });

  it("leaves it to the URL when sslmode is given", () => {
    expect(sslFor("postgresql://u:p@ep-x-pooler.eu-west-2.aws.neon.tech/db?sslmode=require")).toBeUndefined();
  });

  it("does not force TLS on a local database", () => {
    expect(sslFor("postgresql://postgres:postgres@localhost:5432/midnight_dev")).toBeUndefined();
  });
});
