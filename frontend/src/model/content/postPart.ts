export type PostPart =
  | { Plain: string }
  | { Bold: PostPart[] }
  | { Italic: PostPart[] }
  | { Code: PostPart[] }
  | { ReplyTo: { forum: Uint8Array; board: Uint8Array; post: Uint8Array; hint: string } }
  | { Secret: { data_nonce: Uint8Array; data_ct: Uint8Array; encrypted_keys: { nonce: Uint8Array; ct: Uint8Array; tag: Uint8Array }[] } }
  | { Underline: PostPart[] }
  | { Overline: PostPart[] }
  | { Spoiler: PostPart[] }
  | { Strike: PostPart[] }
  | { Sup: PostPart[] }
  | { Sub: PostPart[] }
  | { Link: { url: string; children: PostPart[] } }
  | { Fold: { title: string; children: PostPart[] } }
