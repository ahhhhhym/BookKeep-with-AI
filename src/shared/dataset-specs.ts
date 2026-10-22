import type { ChannelSpec } from './ipc';
import { validDatasetCommand, validDatasetRead, type DatasetCommand, type DatasetRead } from './dataset';
export const DATASET_CHANNELS = { datasetRead: 'dataset.read', datasetCommand: 'dataset.command', datasetSave: 'dataset.save' } as const;
export const DATASET_SPECS = {
    datasetRead: { channel: DATASET_CHANNELS.datasetRead, permission: 'D', skeletonOnly: false, request: { required: ['kind', 'id'], optional: [], allowNullEpoch: false, requireMutationId: false, validatePayload: v => validDatasetRead(v) ? [] : [{ path: 'payload', code: 'INVALID_DATASET_INPUT' }], cast: v => v as unknown as DatasetRead } } as ChannelSpec<DatasetRead>,
    datasetCommand: { channel: DATASET_CHANNELS.datasetCommand, permission: 'D', skeletonOnly: false, request: { required: ['command'], optional: [], allowNullEpoch: false, requireMutationId: true, validatePayload: v => validDatasetCommand(v.command) ? [] : [{ path: 'payload.command', code: 'INVALID_DATASET_INPUT' }], cast: v => v as unknown as {
                command: DatasetCommand;
            } } } as ChannelSpec<{
        command: DatasetCommand;
    }>,
    datasetSave: { channel: DATASET_CHANNELS.datasetSave, permission: 'F', skeletonOnly: false, request: { required: ['artifactId'], optional: [], allowNullEpoch: false, requireMutationId: true, validatePayload: v => typeof v.artifactId === 'string' && /^[a-f0-9-]{36}$/.test(v.artifactId) ? [] : [{ path: 'payload.artifactId', code: 'INVALID_ARTIFACT' }], cast: v => v as {
                artifactId: string;
            } } } as ChannelSpec<{
        artifactId: string;
    }>,
};
