export type LocalMockupSetSnapshot = {
  localWorkId: string; buildId: string; sourceHash: string; aspectClass: string;
  suiteId: string; templateVersion: string; assignmentHash: string;
  boards: {
    templateId: string; templateVersion: string; kind: "thumbnail" | "body_image";
    imageHash: string; width: number; height: number; slideAspectRatio: number;
    sourceSlideNumbers: number[]; png: Buffer;
  }[];
};
