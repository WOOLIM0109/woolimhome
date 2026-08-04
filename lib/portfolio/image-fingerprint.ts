import { createHash } from "node:crypto";
import sharp from "sharp";

export type PortfolioImageFingerprint = {
  contentHash: string;
  visualHash: string;
};

export function perceptualHashDistance(left: string, right: string) {
  let difference = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let distance = 0;
  while (difference > BigInt(0)) {
    distance += Number(difference & BigInt(1));
    difference >>= BigInt(1);
  }
  return distance;
}

export async function fingerprintPortfolioImage(buffer: Buffer): Promise<PortfolioImageFingerprint> {
  const pixels = await sharp(buffer)
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize(9, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer();
  let bits = "";
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const offset = row * 9 + column;
      bits += pixels[offset] > pixels[offset + 1] ? "1" : "0";
    }
  }
  return {
    contentHash: createHash("sha256").update(buffer).digest("hex"),
    visualHash: BigInt(`0b${bits}`).toString(16).padStart(16, "0"),
  };
}

export function findDuplicatePortfolioImage<T extends PortfolioImageFingerprint>(values: T[]) {
  const exact = new Map<string, number>();
  const previous: Array<{ position: number; visualHash: string }> = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const perceptualDuplicate = previous.find((candidate) => (
      perceptualHashDistance(candidate.visualHash, value.visualHash) <= 4
    ));
    const duplicatePosition = exact.get(value.contentHash) ?? perceptualDuplicate?.position;
    if (duplicatePosition !== undefined) return { duplicatePosition, position: index };
    exact.set(value.contentHash, index);
    previous.push({ position: index, visualHash: value.visualHash });
  }
  return null;
}
