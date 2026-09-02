import { analyzeCodeAccessImages, type CodeAccessOcrResult, type OcrMode } from "./ocr";
import { prepareEvidence, uploadPreparedEvidence, type EvidenceKind, type RemoteImage } from "./attachments";
import { deleteUserAttachment } from "@infra/storage/s3";

export type EvidencePipelineItem = { kind: EvidenceKind; image: RemoteImage };
export type EvidencePipelineResult = {
  ocr: CodeAccessOcrResult;
  evidence: Array<{ kind: EvidenceKind; sha256: string; s3Key: string }>;
};

export async function runEvidencePipeline(input: {
  guildId: string;
  userId: string;
  mode: OcrMode;
  items: EvidencePipelineItem[];
  now?: Date;
}): Promise<EvidencePipelineResult> {
  const prepared = await Promise.all(input.items.map((item) => prepareEvidence({
    guildId: input.guildId,
    userId: input.userId,
    kind: item.kind,
    image: item.image,
    now: input.now,
  })));
  const ocrPromise = analyzeCodeAccessImages({
    mode: input.mode,
    images: prepared.map((item) => ({ sha256: item.sha256, dataUrl: item.dataUrl })),
    now: input.now,
  });
  const settled = await Promise.allSettled([ocrPromise, ...prepared.map((item) => uploadPreparedEvidence(item))]);
  const failure = settled.find((item) => item.status === "rejected");
  if (failure) {
    await Promise.allSettled(prepared.map((item) => deleteUserAttachment(item.s3Key)));
    throw failure.reason;
  }
  const ocr = (settled[0] as PromiseFulfilledResult<CodeAccessOcrResult>).value;
  return {
    ocr,
    evidence: prepared.map((item, index) => ({ kind: input.items[index].kind, sha256: item.sha256, s3Key: item.s3Key })),
  };
}
