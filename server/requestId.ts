import type { Request, RequestHandler, Response } from "express";
import { nanoid } from "nanoid";

export type RequestWithId = Request & { requestId?: string };

/** Propagate or generate X-Request-Id for correlation across logs and proxies. */
export const requestIdMiddleware: RequestHandler = (req: RequestWithId, res: Response, next) => {
  const incoming = req.get("x-request-id")?.trim();
  const id = incoming && incoming.length <= 128 ? incoming : nanoid();
  req.requestId = id;
  res.setHeader("x-request-id", id);
  next();
};
