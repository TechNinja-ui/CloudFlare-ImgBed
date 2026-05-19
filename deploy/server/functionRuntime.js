/**
 * Minimal Cloudflare Pages Functions runtime for Node-based deployments.
 */

import { existsSync, statSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '../..');
const FUNCTIONS_DIR = resolve(ROOT_DIR, 'functions');

const FUNCTION_PREFIXES = ['/api/', '/upload', '/file/', '/dav/', '/random'];
const middlewareCache = new Map();
const moduleCache = new Map();

if (typeof globalThis.caches === 'undefined') {
    globalThis.caches = {
        default: {
            async match() { return undefined; },
            async put() {},
            async delete() { return false; },
        },
    };
}

export function isFunctionPath(pathname) {
    return FUNCTION_PREFIXES.some(prefix => pathname.startsWith(prefix));
}

export async function handleFunctionRequest(originalRequest, pathname, envFactory) {
    const funcInfo = findFunctionFile(pathname);
    if (!funcInfo) return null;

    const request = ensureCfRequest(originalRequest);
    const mod = await importModule(funcInfo.file);
    const method = request.method.toUpperCase();
    const methodHandlerName = 'onRequest' + method.charAt(0) + method.slice(1).toLowerCase();

    let handler = null;
    if (typeof mod[methodHandlerName] === 'function') {
        handler = mod[methodHandlerName];
    } else if (mod.onRequest) {
        handler = typeof mod.onRequest === 'function'
            ? mod.onRequest
            : mod.onRequest[mod.onRequest.length - 1];
    }

    if (!handler) {
        return new Response('Method Not Allowed', { status: 405 });
    }

    const middlewares = await findMiddlewares(pathname);
    if (Array.isArray(mod.onRequest) && mod.onRequest.length > 1 && handler === mod.onRequest[mod.onRequest.length - 1]) {
        middlewares.push(...mod.onRequest.slice(0, -1));
    }

    const context = {
        request,
        env: envFactory(),
        params: funcInfo.params,
        waitUntil: promise => {
            if (promise && typeof promise.catch === 'function') {
                promise.catch(err => console.error('waitUntil error:', err));
            }
        },
        next: null,
        data: {},
    };

    return executeChain(middlewares, handler, context);
}

function findFunctionFile(pathname) {
    const parts = pathname.split('/').filter(Boolean);

    if (parts.length > 0) {
        const exactFile = join(FUNCTIONS_DIR, ...parts) + '.js';
        if (existsSync(exactFile) && statSync(exactFile).isFile()) {
            return { file: exactFile, params: {} };
        }
    }

    if (parts.length > 0) {
        const indexFile = join(FUNCTIONS_DIR, ...parts, 'index.js');
        if (existsSync(indexFile) && statSync(indexFile).isFile()) {
            return { file: indexFile, params: {} };
        }
    }

    for (let i = parts.length; i >= 0; i--) {
        const dirParts = parts.slice(0, i);
        const dirPath = join(FUNCTIONS_DIR, ...dirParts);
        if (existsSync(dirPath) && statSync(dirPath).isDirectory()) {
            const catchAllFile = join(dirPath, '[[path]].js');
            if (existsSync(catchAllFile) && statSync(catchAllFile).isFile()) {
                return {
                    file: catchAllFile,
                    params: { path: parts.slice(i) },
                };
            }
        }
    }

    return null;
}

async function findMiddlewares(pathname) {
    if (middlewareCache.has(pathname)) return middlewareCache.get(pathname);

    const parts = pathname.split('/').filter(Boolean);
    const allMiddlewares = [];
    const rootMiddleware = join(FUNCTIONS_DIR, '_middleware.js');

    if (existsSync(rootMiddleware)) {
        const mod = await importModule(rootMiddleware);
        if (mod.onRequest) {
            const handlers = Array.isArray(mod.onRequest) ? mod.onRequest : [mod.onRequest];
            allMiddlewares.push(...handlers);
        }
    }

    for (let i = 1; i <= parts.length; i++) {
        const middlewareFile = join(FUNCTIONS_DIR, ...parts.slice(0, i), '_middleware.js');
        if (existsSync(middlewareFile) && statSync(middlewareFile).isFile()) {
            const mod = await importModule(middlewareFile);
            if (mod.onRequest) {
                const handlers = Array.isArray(mod.onRequest) ? mod.onRequest : [mod.onRequest];
                allMiddlewares.push(...handlers);
            }
        }
    }

    middlewareCache.set(pathname, allMiddlewares);
    return allMiddlewares;
}

async function importModule(filePath) {
    if (moduleCache.has(filePath)) return moduleCache.get(filePath);
    const mod = await import(pathToFileURL(filePath).href);
    moduleCache.set(filePath, mod);
    return mod;
}

async function executeChain(middlewares, handler, context) {
    const chain = [...middlewares, handler];
    let index = 0;

    context.next = async function () {
        if (index < chain.length) {
            const fn = chain[index++];
            return fn(context);
        }
        return new Response('Not Found', { status: 404 });
    };

    return context.next();
}

function ensureCfRequest(request) {
    if (!request.cf) {
        request.cf = {
            country: 'XX',
            city: 'Unknown',
            continent: 'XX',
            latitude: '0',
            longitude: '0',
            region: '',
            regionCode: '',
            timezone: '',
            postalCode: '',
            asn: 0,
            asOrganization: '',
            colo: 'VERCEL',
            httpProtocol: 'HTTP/1.1',
            requestPriority: '',
            tlsCipher: '',
            tlsVersion: '',
        };
    }
    return request;
}
