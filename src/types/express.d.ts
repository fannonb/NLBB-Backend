import type { UserRole } from "./domain";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      auth?: {
        uid: string;
        email: string;
        role: UserRole;
        status: "active" | "disabled";
        sessionId: string;
      };
    }
  }
}

export {};
