export type OpenedRecordingSource = {
  body: AsyncIterable<Uint8Array>;
  contentType: string;
  contentLength: number | null;
};

export interface RecordingSource {
  open(sourceUrl: string): Promise<OpenedRecordingSource>;
}
