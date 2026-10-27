/** Web Worker: parses one file off the main thread and posts progress, then the document. */
import pdfWorkerSrc from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { parseFile } from "./index";
import type { ParseRequest, ParseResponse } from "./protocol";
import { ParseError } from "./types";

const scope = self as unknown as {
  postMessage(message: ParseResponse): void;
  onmessage: ((event: MessageEvent<ParseRequest>) => void) | null;
};

scope.onmessage = ({ data: request }) => {
  parseFile(request.name, new Uint8Array(request.data), {
    mime: request.mime,
    pdfWorkerSrc,
    onProgress: (progress) => scope.postMessage({ type: "progress", progress }),
  })
    .then((doc) => scope.postMessage({ type: "done", doc }))
    .catch((e: unknown) => {
      const error = e instanceof ParseError ? e : new ParseError("parse_error", "This file couldn't be read. It may be damaged.");
      scope.postMessage({ type: "error", code: error.code, message: error.message });
    });
};
