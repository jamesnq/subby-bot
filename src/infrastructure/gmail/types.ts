export type GmailAuth = {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
};

export type GmailPayload = {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string };
  parts?: GmailPayload[];
};

export type GmailMessage = {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPayload;
};

export type GmailListResponse = {
  nextPageToken?: string;
  messages?: Array<{ id: string; threadId?: string }>;
};

export type TokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

export type ApiErrorResponse = {
  error?: string | { message?: string };
};
