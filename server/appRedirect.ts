import type { Response } from "express";
import { withAppBase } from "@shared/appPaths";
import { APP_BASE_PATH } from "./appBase";

/** Browser path including APP_BASE_PATH (e.g. `/midnight/sign-in`). */
export function appRedirectPath(path: string): string {
  return withAppBase(APP_BASE_PATH, path);
}

export function redirectToAppPath(res: Response, path: string, status = 302): void {
  res.redirect(status, appRedirectPath(path));
}
