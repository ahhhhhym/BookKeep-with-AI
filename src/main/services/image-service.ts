import sharp from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readFileSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readBoundedFile, regularPath } from '../storage/safe-file';
import { AppError, type ErrorCode } from '../../shared/errors';
import { IMAGE_LIMIT, type Asset, type ImportInput, type ImportResult, type PrepareInput, type Rect, type Resource, type ResourceInput } from '../../shared/imports';
import { isUuidV4 } from '../../shared/validation';
import type { LedgerStore } from './ledger-store';
import { change } from './import-context';
import { findReceipt } from '../db/receipt-repo';
import { hashPayload } from './canonical';
export const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
type AssetRow = {
    id: string;
    version: number;
    original_hash: string;
    prepared_hash: string | null;
    original_ref: string | null;
    prepared_ref: string | null;
    width: number;
    height: number;
    byte_size: number;
    original_retained: number;
    parent_asset_id: string | null;
    source: Asset['source'];
    created_at: string;
    retention: ImportInput['retention'];
};
function dto(r: AssetRow): Asset { return { id: r.id, version: r.version, originalHash: r.original_hash, preparedHash: r.prepared_hash, width: r.width, height: r.height, byteSize: r.byte_size, originalRetained: r.original_retained === 1, parentAssetId: r.parent_asset_id, source: r.source, createdAt: r.created_at }; }
export function atomicFile(file: string, bytes: Buffer): void {
    const tmp = file + '.' + randomUUID() + '.tmp';
    const fd = openSync(tmp, 'wx');
    try {
        writeFileSync(fd, bytes);
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
    try {
        renameSync(tmp, file);
    }
    catch {
        try {
            unlinkSync(tmp);
        }
        catch { /* next startup */ }
        throw new AppError('STORAGE_UNAVAILABLE');
    }
}
const signature = (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png' : b[0] === 255 && b[1] === 216 && b[2] === 255 ? 'jpeg' : b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
export async function inspectImage(bytes: Buffer): Promise<{
    width: number;
    height: number;
    png: Buffer;
}> {
    if (!bytes.length || bytes.length > IMAGE_LIMIT)
        throw new AppError('IMAGE_TOO_LARGE');
    const format = signature(bytes);
    if (!format)
        throw new AppError('IMAGE_FORMAT');
    try {
        const image = sharp(bytes, { limitInputPixels: 8192 * 8192, failOn: 'warning' });
        // Metadata reads headers, not pixels. Check dimensions ourselves before full bounded decode.
        const meta = await sharp(bytes, { limitInputPixels: false, failOn: 'warning' }).metadata();
        if (meta.format !== format)
            throw new AppError('IMAGE_FORMAT');
        if (!meta.width || !meta.height || meta.width > 8192 || meta.height > 8192 || (meta.pages ?? 1) > 1)
            throw new AppError('IMAGE_DIMENSION');
        // Full decode before persistence. No EXIF/ICC/XMP is copied to PNG.
        const png = await image.png({ compressionLevel: 9 }).toBuffer();
        if (png.length > IMAGE_LIMIT)
            throw new AppError('IMAGE_TOO_LARGE');
        return { width: meta.width, height: meta.height, png };
    }
    catch (e) {
        if (e instanceof AppError)
            throw e;
        throw new AppError('IMAGE_DECODE');
    }
}
function validRegion(r: Rect, width: number, height: number): boolean {
    return [r.x, r.y, r.width, r.height].every(Number.isSafeInteger) && r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x + r.width <= width && r.y + r.height <= height;
}
export class ImageService {
    private tail: Promise<unknown> = Promise.resolve();
    private resources = new Map<string, {
        id: string;
        variant: 'original' | 'prepared';
        owner: number;
        epoch: string;
        x: number;
    }>();
    constructor(private readonly store: LedgerStore, private readonly owner: () => number | null, private readonly clock = Date.now) {
        this.cleanStages();
        const cleanup = this.store.withImports(false, c => c.db.prepare<AssetRow>("SELECT * FROM image_asset WHERE retention='prepared_only' AND (original_ref IS NOT NULL OR prepared_ref IS NOT NULL)").all());
        for (const row of cleanup) {
            try {
                this.purgeOriginal(row.id);
            }
            catch { /* retain truthful original reference until successful retry */ }
        }
    }
    private purgeOriginal(id: string): void {
        const row = this.asset(id);
        if (row.retention !== 'prepared_only' || (!row.original_ref && !row.prepared_ref))
            return;
        this.cleanStages(true);
        const safe = this.store.withImports(false, c => !c.db.prepare('SELECT id FROM import_job WHERE image_asset_id=? LIMIT 1').get(id) && !!c.db.prepare("SELECT id FROM image_asset WHERE parent_asset_id=? AND source='prepared' LIMIT 1").get(id));
        if (!safe)
            return;
        try {
            for(const ref of [row.original_ref,row.prepared_ref])if(ref){
                const file = this.safe(ref);
                if (existsSync(file))unlinkSync(file);
            }
        }
        catch {
            throw new AppError('FILE_BUSY');
        }
        change(this.store, 'image.purgeOriginal', null, { id }, c => { c.db.prepare('UPDATE image_asset SET original_ref=NULL,original_retained=0,prepared_ref=NULL,prepared_hash=NULL,version=version+1 WHERE id=?').run(id); return null; });
    }
    private ancestors(id:string):AssetRow[] {
        const rows:AssetRow[]=[];const seen=new Set<string>();let current:string|null=id;
        while(current){if(seen.has(current)||seen.size>=1000)throw new AppError('INTEGRITY_ERROR');seen.add(current);const row=this.asset(current);rows.push(row);current=row.parent_asset_id;}
        return rows;
    }
    private purgeChain(id:string):void { for(const row of this.ancestors(id))this.purgeOriginal(row.id); }
    private root(): string {
        return this.store.withImports(false, ctx => {
            mkdirSync(ctx.directory, { recursive: true });
            if (lstatSync(ctx.directory).isSymbolicLink() || realpathSync(ctx.directory) !== path.resolve(ctx.directory))
                throw new AppError('PERMISSION_DENIED');
            return ctx.directory;
        });
    }
    private safe(ref: string): string {
        if (!/^[a-f0-9-]{36}-(original\.bin|prepared\.png|stage\.bin|stage\.json)$/.test(ref))
            throw new AppError('PERMISSION_DENIED');
        const file = regularPath(path.join(this.root(), ref),this.store.diagnostics().root,false);
        if (existsSync(file) && lstatSync(file).isSymbolicLink())
            throw new AppError('PERMISSION_DENIED');
        return file;
    }
    private cleanStages(strict = false): void {
        for (const name of readdirSync(this.root()))
            if (/^[a-f0-9-]{36}-stage\.json$/.test(name)) {
                try {
                    const file = this.safe(name);
                    const m = JSON.parse(readFileSync(file, 'utf8'));
                    if (m.consumed || m.x < this.clock()) {
                        const bin = this.safe(name.replace('.json', '.bin'));
                        if (existsSync(bin))
                            unlinkSync(bin);
                        unlinkSync(file);
                    }
                }
                catch {
                    if (strict)
                        throw new AppError('FILE_BUSY'); /* no unbounded deletion */
                }
            }
    }
    /** Called only by main native picker or isolated preload webUtils; never public path API. */
    select(paths: string[], source: 'selection' | 'drop'): {
        tokens: string[];
    } {
        if (paths.length > 20)
            throw new AppError('BATCH_LIMIT');
        const tokens: string[] = [];
        for (const file of paths) {
            const token = randomUUID();
            let bytes: Buffer | null = null;
            let errorCode: ErrorCode | null = null;
            try {
                if (!path.isAbsolute(file) || (regularPath(file,path.parse(file).root), lstatSync(file).isSymbolicLink()))
                    throw new AppError('IMAGE_FORMAT');
                const fd = openSync(file, 'r');
                try {
                    const stat = fstatSync(fd);
                    if (!stat.isFile())
                        throw new AppError('IMAGE_FORMAT');
                    if (stat.size > IMAGE_LIMIT)
                        throw new AppError('IMAGE_TOO_LARGE');
                    const buffer = Buffer.alloc(Math.min(stat.size + 1, IMAGE_LIMIT + 1));
                    let size = 0;
                    while (size < buffer.length) {
                        const n = readSync(fd, buffer, size, buffer.length - size, null);
                        if (!n)
                            break;
                        size += n;
                    }
                    if (size > IMAGE_LIMIT || size > stat.size)
                        throw new AppError('IMAGE_TOO_LARGE');
                    bytes = buffer.subarray(0, size);
                }
                finally {
                    closeSync(fd);
                }
            }
            catch (e) {
                errorCode = e instanceof AppError ? e.code : 'STORAGE_UNAVAILABLE';
            }
            if (bytes && !errorCode)
                atomicFile(this.safe(`${token}-stage.bin`), bytes);
            atomicFile(this.safe(`${token}-stage.json`), Buffer.from(JSON.stringify({ owner: this.owner(), epoch: this.store.currentEpoch, x: this.clock() + 300000, source, errorCode, consumed: false })));
            tokens.push(token);
        }
        return { tokens };
    }
    private serialize<T>(fn: () => Promise<T>): Promise<T> {
        const next = this.tail.then(fn, fn);
        this.tail = next.catch(() => undefined);
        return next;
    }
    asset(id: string): AssetRow {
        const row = this.store.withImports(false, c => c.db.prepare<AssetRow>('SELECT * FROM image_asset WHERE id=? AND ledger_id=? AND deleted_at IS NULL').get(id, c.ledgerId));
        if (!row)
            throw new AppError('NOT_FOUND');
        return row;
    }
    import(input: ImportInput, mutationId: string): Promise<ImportResult> {
        const epoch = this.store.currentEpoch;
        return this.serialize(async () => {
            if (this.store.currentEpoch !== epoch)
                throw new AppError('STALE_EPOCH');
            const payloadHash = hashPayload({ operation: 'image.import', payload: input });
            const old = this.store.withImports(false, c => findReceipt(c.db, c.ledgerId, 'image.import', mutationId));
            if (old) {
                if (old.payload_hash !== payloadHash)
                    throw new AppError('IDEMPOTENCY_CONFLICT');
                return JSON.parse(old.result_snapshot_json) as ImportResult;
            }
            if (input.selectionTokens.length > 20)
                throw new AppError('BATCH_LIMIT');
            const results: ImportResult['results'] = [];
            for (let i = 0; i < input.selectionTokens.length; i++) {
                const op = `image.import.item.${i}`;
                const token = input.selectionTokens[i]!;
                const prior = this.store.withImports(false, c => findReceipt(c.db, c.ledgerId, op, mutationId));
                if (prior) {
                    if (prior.payload_hash !== hashPayload({ operation: op, payload: { token, retention: input.retention } }))
                        throw new AppError('IDEMPOTENCY_CONFLICT');
                    results.push(JSON.parse(prior.result_snapshot_json));
                    continue;
                }
                let result: ImportResult['results'][number];
                try {
                    if (!isUuidV4(token))
                        throw new AppError('PERMISSION_DENIED');
                    const m = JSON.parse(readFileSync(this.safe(`${token}-stage.json`), 'utf8'));
                    if (m.owner !== this.owner() || m.epoch !== this.store.currentEpoch || m.consumed)
                        throw new AppError('PERMISSION_DENIED');
                    if (m.x < this.clock())
                        throw new AppError('TOKEN_EXPIRED');
                    if (m.errorCode)
                        throw new AppError(m.errorCode);
                    const bytes = readFileSync(this.safe(`${token}-stage.bin`));
                    const info = await inspectImage(bytes);
                    if (this.store.currentEpoch !== epoch)
                        throw new AppError('STALE_EPOCH');
                    const hash = sha256(bytes);
                const match = this.store.withImports(false, c => c.db.prepare<AssetRow>('SELECT * FROM image_asset WHERE ledger_id=? AND deleted_at IS NULL AND (original_ref IS NOT NULL OR prepared_ref IS NOT NULL) AND (original_hash=? OR prepared_hash=?) ORDER BY (prepared_hash IS NOT NULL) DESC,created_at DESC,id DESC LIMIT 1').get(c.ledgerId, hash, hash));
                    if (match)
                        result = { asset: dto(match), errorCode: null, reused: true };
                    else {
                        const id = randomUUID();
                        atomicFile(this.safe(`${id}-original.bin`), bytes);
                        result = change(this.store, op, mutationId, { token, retention: input.retention }, c => {
                            c.db.prepare('INSERT INTO image_asset(id,ledger_id,source,original_hash,original_ref,width,height,byte_size,original_retained,retention,transform_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
                                .run(id, c.ledgerId, m.source, hash, `${id}-original.bin`, info.width, info.height, bytes.length, 1, input.retention, '{}', new Date(this.clock()).toISOString());
                            return { asset: dto(this.asset(id)), errorCode: null, reused: false };
                        });
                    }
                }
                catch (e) {
                    if (e instanceof AppError && e.code === 'STALE_EPOCH')
                        throw e;
                    result = { asset: null, errorCode: e instanceof AppError ? e.code : 'STORAGE_UNAVAILABLE', reused: false };
                }
                // Successful new imports already have a receipt; failures and reused entries need one too.
                result = change(this.store, op, mutationId, { token, retention: input.retention }, () => result);
                results.push(result);
                // Receipt precedes consuming token. Stage can recover unfinished ordinal after process crash.
                try {
                    const file = this.safe(`${token}-stage.json`);
                    const m = JSON.parse(readFileSync(file, 'utf8'));
                    m.consumed = true;
                    atomicFile(file, Buffer.from(JSON.stringify(m)));
                    const bin = this.safe(`${token}-stage.bin`);
                    if (existsSync(bin))
                        unlinkSync(bin);
                }
                catch { /* receipt remains authoritative; expired stages cleaned on startup */ }
            }
            return change(this.store, 'image.import', mutationId, input, () => ({ batchId: mutationId, results }));
        });
    }
    prepare(input: PrepareInput, mutationId: string): Promise<Asset> {
        const epoch = this.store.currentEpoch;
        return this.serialize(async () => {
            if (this.store.currentEpoch !== epoch)
                throw new AppError('STALE_EPOCH');
            const old = this.store.withImports(false, c => findReceipt(c.db, c.ledgerId, 'image.prepare', mutationId));
            if (old) {
                if (old.payload_hash !== hashPayload({ operation: 'image.prepare', payload: input }))
                    throw new AppError('IDEMPOTENCY_CONFLICT');
                if (!input.retainOriginal)
                    this.purgeChain(input.imageAssetId);
                return JSON.parse(old.result_snapshot_json);
            }
            const r = this.asset(input.imageAssetId);
            if (r.version !== input.expectedVersion)
                throw new AppError('VERSION_CONFLICT');
            const ref = r.prepared_ref ?? r.original_ref;
            if (!ref)
                throw new AppError('ARTIFACT_MISSING');
            const bytes = readBoundedFile(this.safe(ref),IMAGE_LIMIT);
            if (sha256(bytes) !== (r.prepared_hash ?? r.original_hash))
                throw new AppError('HASH_MISMATCH');
            const info = await inspectImage(bytes);
            const crop = input.crop ?? { x: 0, y: 0, width: info.width, height: info.height };
            if (!validRegion(crop, info.width, info.height) || input.masks.length > 50 || !input.masks.every(m => validRegion(m, crop.width, crop.height)))
                throw new AppError('IMAGE_REGION_INVALID');
            let pixels = sharp(info.png).extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height });
            if (input.masks.length)
                pixels = pixels.composite(input.masks.map(m => ({ input: { create: { width: m.width, height: m.height, channels: 4 as const, background: { r: 0, g: 0, b: 0, alpha: 1 } } }, left: m.x, top: m.y, blend: 'over' as const })));
            const prepared = await pixels.png({ compressionLevel: 9 }).toBuffer();
            if (prepared.length > IMAGE_LIMIT)
                throw new AppError('IMAGE_TOO_LARGE');
            if (this.store.currentEpoch !== epoch)
                throw new AppError('STALE_EPOCH');
            const id = randomUUID();
            atomicFile(this.safe(`${id}-prepared.png`), prepared);
            // Child owns an independent original copy; deleting a source never breaks old upload snapshots.
            let originalRef: string | null = null;
            if (input.retainOriginal && r.original_ref) {
                originalRef = `${id}-original.bin`;
                atomicFile(this.safe(originalRef), readFileSync(this.safe(r.original_ref)));
            }
            const asset = change(this.store, 'image.prepare', mutationId, input, c => {
                if (this.asset(r.id).version !== input.expectedVersion)
                    throw new AppError('VERSION_CONFLICT');
                c.db.prepare('INSERT INTO image_asset(id,ledger_id,parent_asset_id,source,original_hash,prepared_hash,original_ref,prepared_ref,width,height,byte_size,original_retained,retention,transform_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
                    .run(id, c.ledgerId, r.id, 'prepared', r.original_hash, sha256(prepared), originalRef, `${id}-prepared.png`, crop.width, crop.height, prepared.length, originalRef ? 1 : 0, input.retainOriginal ? 'keep_original' : 'prepared_only', JSON.stringify({ crop, masks: input.masks }), new Date(this.clock()).toISOString());
                if (!input.retainOriginal)for(const ancestor of this.ancestors(r.id)){
                    if(!c.db.prepare('SELECT id FROM import_job WHERE image_asset_id=? LIMIT 1').get(ancestor.id))
                        c.db.prepare("UPDATE image_asset SET retention='prepared_only',version=version+1 WHERE id=?").run(ancestor.id);
                }
                return dto(this.asset(id));
            });
            // Only remove original after prepared file + row + receipt committed. Referenced parents are immutable.
            if (!input.retainOriginal)
                this.purgeChain(r.id);
            return asset;
        });
    }
    resource(input: ResourceInput): Resource {
        const r = this.asset(input.imageAssetId);
        if (!(input.variant === 'original' ? r.original_ref : r.prepared_ref))
            throw new AppError('ARTIFACT_MISSING');
        for (const [key, v] of this.resources)
            if (v.x < this.clock())
                this.resources.delete(key);
        if (this.resources.size >= 1000)
            throw new AppError('STATE_CONFLICT');
        const token = randomUUID();
        const x = this.clock() + 300000;
        this.resources.set(token, { id: r.id, variant: input.variant, owner: this.owner() ?? -1, epoch: this.store.currentEpoch, x });
        return { url: `bookkeep://app/image/${token}`, expiresAt: x, asset: dto(r) };
    }
    async readResource(token: string): Promise<Buffer> {
        const v = this.resources.get(token);
        if (!v || v.owner !== this.owner() || v.epoch !== this.store.currentEpoch)
            throw new AppError('PERMISSION_DENIED');
        if (v.x < this.clock())
            throw new AppError('TOKEN_EXPIRED');
        const r = this.asset(v.id);
        const ref = v.variant === 'original' ? r.original_ref : r.prepared_ref;
        if (!ref)
            throw new AppError('ARTIFACT_MISSING');
        const bytes = readFileSync(this.safe(ref));
        if (sha256(bytes) !== (v.variant === 'original' ? r.original_hash : r.prepared_hash))
            throw new AppError('HASH_MISMATCH');
        const result=v.variant === 'original' ? (await inspectImage(bytes)).png : bytes;
        if(v.owner!==this.owner()||v.epoch!==this.store.currentEpoch||v.x<this.clock())throw new AppError('TOKEN_EXPIRED');
        return result;
    }
    readPrepared(id: string, hash: string): Buffer {
        const r = this.asset(id);
        if (!r.prepared_ref || r.prepared_hash !== hash)
            throw new AppError('IMAGE_NOT_PREPARED');
        const bytes = readBoundedFile(this.safe(r.prepared_ref),IMAGE_LIMIT);
        if (bytes.length > IMAGE_LIMIT || sha256(bytes) !== hash)
            throw new AppError('HASH_MISMATCH');
        return bytes;
    }
    delete(input: {
        imageAssetId: string;
        expectedVersion: number;
        confirmed: true;
    }, mutationId: string): {
        deleted: true;
        id: string;
    } {
        const result = change(this.store, 'image.delete', mutationId, input, c => {
            const r = this.asset(input.imageAssetId);
            if (r.version !== input.expectedVersion)
                throw new AppError('VERSION_CONFLICT');
            if (c.db.prepare('SELECT id FROM import_job WHERE image_asset_id=? LIMIT 1').get(r.id) || c.db.prepare('SELECT id FROM image_asset WHERE parent_asset_id=? AND deleted_at IS NULL LIMIT 1').get(r.id))
                throw new AppError('IMAGE_IN_USE');
            // Metadata soft-delete first; files retained on unlink failure for safe retry/maintenance.
            c.db.prepare('UPDATE image_asset SET deleted_at=?,version=version+1 WHERE id=?').run(new Date(this.clock()).toISOString(), r.id);
            return { deleted: true as const, id: r.id };
        });
        const row = this.store.withImports(false, c => c.db.prepare<AssetRow>('SELECT * FROM image_asset WHERE id=? AND ledger_id=?').get(input.imageAssetId, c.ledgerId));
        for (const ref of [row?.original_ref, row?.prepared_ref])
            if (ref) {
                try {
                    const file = this.safe(ref);
                    if (existsSync(file))
                        unlinkSync(file);
                }
                catch {
                    throw new AppError('FILE_BUSY');
                }
            }
        return result;
    }
}
