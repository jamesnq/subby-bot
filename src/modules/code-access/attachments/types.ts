export type EvidenceKind = "order" | "device" | "steam";

export type PreparedEvidence = {
  sha256: string;
  s3Key: string;
  dataUrl: string;
  width?: number;
  height?: number;
};

export type UploadableEvidence = PreparedEvidence & {
  body: Buffer;
};

export type RemoteImage = {
  url: string;
  contentType?: string | null;
  size?: number;
};
