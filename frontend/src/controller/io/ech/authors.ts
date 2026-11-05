export interface IdCandidate {
  id: string;
  bytes: Uint8Array;
}
export async function matchPostsByAuthor(_opts: {
  relayUrl: string;
  pathHex: string[];
  pk: Uint8Array;
  secretKey: Uint8Array;
  refId: string;
  candidates: IdCandidate[];
  onProgress?: (done: number, total: number) => void;
}): Promise<string[]> {
  throw new Error(
    "Сопоставление авторов недоступно: SID не раскрывается модераторам",
  );
}
