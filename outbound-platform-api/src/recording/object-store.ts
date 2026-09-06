export type PutRecordingObjectInput = {
  bucket: string;
  objectKey: string;
  body: AsyncIterable<Uint8Array>;
};

export interface RecordingObjectStore {
  putObject(input: PutRecordingObjectInput): Promise<void>;
}

export type OpenedRecordingObject = {
  body: AsyncIterable<Uint8Array>;
  sizeBytes: bigint;
};

export interface RecordingObjectReader {
  openObject(input: {
    bucket: string;
    objectKey: string;
  }): Promise<OpenedRecordingObject>;
}
