import type { Request, Response, NextFunction } from "express";

// declare global {
//   namespace Express {
//     interface Request {
//       userId?: string;
//     }
//   }
// }

export function mockAuth(req: Request, res: Response, next: NextFunction) {
  const userId = process.env.MOCK_USER_ID;
  // TODO: replace with real auth later
  if (!userId) {
    return res.status(500).json({
      error: {
        code: "SERVER_MISCONFIG",
        message: "MOCK_USER_ID is not set",
      },
    });
  }

  req.userId = userId;
  next();
}
