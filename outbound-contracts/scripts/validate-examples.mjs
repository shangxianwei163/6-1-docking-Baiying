import { readFile } from 'node:fs/promises';
import {
  callbackAckSchema,
  callResultBatchEventSchema,
  createOutboundTaskRequestSchema,
  recordingAvailableBatchEventSchema,
  taskAcceptedEnvelopeSchema,
  taskCompletedEventSchema,
  taskStartedEventSchema,
  taskStartFailedEventSchema,
} from '../dist/index.js';

async function readExample(name) {
  const content = await readFile(
    new URL(`../examples/${name}`, import.meta.url),
    'utf8',
  );
  return JSON.parse(content);
}

const validExamples = [
  ['erp-create-task.request.json', createOutboundTaskRequestSchema],
  ['crm-create-task.request.json', createOutboundTaskRequestSchema],
  ['task-accepted.response.json', taskAcceptedEnvelopeSchema],
  ['task-started.event.json', taskStartedEventSchema],
  ['task-start-failed.event.json', taskStartFailedEventSchema],
  ['call-result-batch.event.json', callResultBatchEventSchema],
  ['recording-available-batch.event.json', recordingAvailableBatchEventSchema],
  ['task-completed.event.json', taskCompletedEventSchema],
  ['callback-ack.response.json', callbackAckSchema],
];

for (const [name, schema] of validExamples) {
  schema.parse(await readExample(name));
}

const baseRequest = await readExample('erp-create-task.request.json');
const duplicatePhoneRequest = structuredClone(baseRequest);
duplicatePhoneRequest.customers.push({
  ...duplicatePhoneRequest.customers[0],
  externalCustomerId: 'ERP-C-10002',
  phone: '+8613800000000',
});

if (createOutboundTaskRequestSchema.safeParse(duplicatePhoneRequest).success) {
  throw new Error('归一化后的重复手机号必须被契约拒绝');
}

const tooManyFieldsRequest = structuredClone(baseRequest);
tooManyFieldsRequest.customers[0].fields = Object.fromEntries(
  Array.from({ length: 101 }, (_, index) => [`field_${index}`, String(index)]),
);

if (createOutboundTaskRequestSchema.safeParse(tooManyFieldsRequest).success) {
  throw new Error('超过 100 个客户业务字段的请求必须被契约拒绝');
}

console.log(
  `Validated ${validExamples.length} contract examples and 2 rejection cases.`,
);
