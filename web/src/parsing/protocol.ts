/** Messages between the app and the parsing worker. */
import type { ParseErrorCode, ParseProgress, StructuredDocument } from "./types";

export interface ParseRequest {
  name: string;
  mime: string;
  data: ArrayBuffer;
}

export type ParseResponse =
  | { type: "progress"; progress: ParseProgress }
  | { type: "done"; doc: StructuredDocument }
  | { type: "error"; code: ParseErrorCode; message: string };
