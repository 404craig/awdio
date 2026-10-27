/** Main-thread side of parsing: reads the file and hands it to a short-lived worker. */
import type { ParseRequest, ParseResponse } from "./protocol";
import { ParseError, type ProgressFn, type StructuredDocument } from "./types";

export function parseInWorker(file: File, onProgress: ProgressFn): Promise<StructuredDocument> {
  onProgress({ phase: "reading", fraction: null });
  return file.arrayBuffer().then(
    (data) =>
      new Promise<StructuredDocument>((resolve, reject) => {
        const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
        const finish = () => worker.terminate();
        worker.onmessage = ({ data: message }: MessageEvent<ParseResponse>) => {
          if (message.type === "progress") return onProgress(message.progress);
          if (message.type !== "done" && message.type !== "error") return; // not ours
          finish();
          if (message.type === "done") resolve(message.doc);
          else reject(new ParseError(message.code, message.message));
        };
        worker.onerror = (event) => {
          event.preventDefault();
          finish();
          reject(new ParseError("parse_error", "This file couldn't be read on this device."));
        };
        const request: ParseRequest = { name: file.name, mime: file.type, data };
        worker.postMessage(request, [data]);
      }),
  );
}
