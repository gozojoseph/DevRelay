import 'express';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      actor?: { userId: string; accountId: string | null; role: 'developer' | 'admin'; sessionToken: string; mfaEnabled: boolean };
      apiActor?: { accountId: string; projectId: string; keyId: string; scopes: string[] };
    }
  }
}
