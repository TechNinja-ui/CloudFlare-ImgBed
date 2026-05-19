/**
 * Cloudflare R2 adapter using the S3-compatible API.
 * It mirrors the subset of the R2 binding API used by this project.
 */

import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

export class CloudflareR2Storage {
    constructor(options = {}) {
        this.accountId = options.accountId || process.env.CLOUDFLARE_ACCOUNT_ID;
        this.bucket = options.bucket || process.env.CLOUDFLARE_R2_BUCKET || process.env.R2_BUCKET;
        const accessKeyId = options.accessKeyId || process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
        const secretAccessKey = options.secretAccessKey || process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;
        const endpoint = options.endpoint || process.env.CLOUDFLARE_R2_ENDPOINT || (this.accountId ? `https://${this.accountId}.r2.cloudflarestorage.com` : '');

        if (!endpoint || !this.bucket || !accessKeyId || !secretAccessKey) {
            throw new Error('Cloudflare R2 is not configured. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_R2_BUCKET, CLOUDFLARE_R2_ACCESS_KEY_ID and CLOUDFLARE_R2_SECRET_ACCESS_KEY.');
        }

        this.client = new S3Client({
            region: options.region || process.env.CLOUDFLARE_R2_REGION || 'auto',
            endpoint,
            credentials: { accessKeyId, secretAccessKey },
            forcePathStyle: true,
        });
    }

    async get(key, options = {}) {
        try {
            const input = {
                Bucket: this.bucket,
                Key: key,
            };

            if (options.range) {
                const offset = options.range.offset || 0;
                const length = options.range.length;
                const end = length ? offset + length - 1 : '';
                input.Range = `bytes=${offset}-${end}`;
            }

            const result = await this.client.send(new GetObjectCommand(input));
            const headers = new Headers();
            if (result.ContentType) headers.set('Content-Type', result.ContentType);
            if (result.ContentLength !== undefined) headers.set('Content-Length', String(result.ContentLength));
            if (result.ContentRange) headers.set('Content-Range', result.ContentRange);
            if (result.ETag) headers.set('ETag', result.ETag);
            if (result.CacheControl) headers.set('Cache-Control', result.CacheControl);

            return {
                body: result.Body?.transformToWebStream ? result.Body.transformToWebStream() : result.Body,
                size: result.ContentLength || 0,
                httpMetadata: {
                    contentType: result.ContentType,
                    cacheControl: result.CacheControl,
                },
                range: parseContentRange(result.ContentRange),
                writeHttpMetadata(targetHeaders) {
                    for (const [name, value] of headers.entries()) {
                        targetHeaders.set(name, value);
                    }
                },
            };
        } catch (error) {
            const status = error?.$metadata?.httpStatusCode;
            if (error?.name === 'NoSuchKey' || status === 404) return null;
            throw error;
        }
    }

    async put(key, value) {
        await this.client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: await toBody(value),
            ContentType: value?.type || undefined,
        }));
    }

    async delete(key) {
        await this.client.send(new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: key,
        }));
    }

    async createMultipartUpload(key) {
        const result = await this.client.send(new CreateMultipartUploadCommand({
            Bucket: this.bucket,
            Key: key,
        }));

        return {
            key,
            uploadId: result.UploadId,
            ...this._createMultipartMethods(key, result.UploadId),
        };
    }

    resumeMultipartUpload(key, uploadId) {
        return {
            key,
            uploadId,
            ...this._createMultipartMethods(key, uploadId),
        };
    }

    _createMultipartMethods(key, uploadId) {
        const self = this;
        return {
            async uploadPart(partNumber, data) {
                const result = await self.client.send(new UploadPartCommand({
                    Bucket: self.bucket,
                    Key: key,
                    UploadId: uploadId,
                    PartNumber: partNumber,
                    Body: await toBody(data),
                }));
                return {
                    etag: result.ETag,
                    partNumber,
                };
            },

            async complete(parts) {
                const sortedParts = [...parts].sort((a, b) => a.partNumber - b.partNumber);
                await self.client.send(new CompleteMultipartUploadCommand({
                    Bucket: self.bucket,
                    Key: key,
                    UploadId: uploadId,
                    MultipartUpload: {
                        Parts: sortedParts.map(part => ({
                            ETag: part.etag || part.ETag,
                            PartNumber: part.partNumber || part.PartNumber,
                        })),
                    },
                }));
            },

            async abort() {
                await self.client.send(new AbortMultipartUploadCommand({
                    Bucket: self.bucket,
                    Key: key,
                    UploadId: uploadId,
                }));
            },
        };
    }
}

async function toBody(value) {
    if (value instanceof Blob || (typeof File !== 'undefined' && value instanceof File)) {
        return Buffer.from(await value.arrayBuffer());
    }
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    if (value instanceof Uint8Array || Buffer.isBuffer(value)) return value;
    if (value instanceof ReadableStream) return Readable.fromWeb(value);
    if (typeof value === 'string') return value;
    return value;
}

function parseContentRange(contentRange) {
    if (!contentRange) return undefined;
    const match = contentRange.match(/bytes\s+(\d+)-(\d+)\/(\d+|\*)/i);
    if (!match) return undefined;
    const start = Number(match[1]);
    const end = Number(match[2]);
    return {
        offset: start,
        length: end - start + 1,
    };
}
