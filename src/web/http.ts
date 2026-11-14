import type { NextFunction, Request, Response } from "express";

// Express 4 não captura erros de funções async sozinho
export const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);
