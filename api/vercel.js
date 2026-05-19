import { register } from 'node:module';

register('../deploy/server/loader.mjs', import.meta.url);

const runtimePromise = Promise.all([
    import('../deploy/server/functionRuntime.js'),
    import('../deploy/server/cloudflareD1.js'),
    import('../deploy/server/cloudflareR2.js'),
]);

let d1;
let r2;

export const config = {
    api: {
        bodyParser: false,
    },
};

export default async function handler(req, res) {
    try {
        const [{ handleFunctionRequest, isFunctionPath }, { CloudflareD1 }, { CloudflareR2Storage }] = await runtimePromise;
        const pathname = getOriginalPath(req);

        if (!isFunctionPath(pathname)) {
            return sendNodeResponse(res, new Response('Not Found', { status: 404 }));
        }

        const request = toWebRequest(req, pathname);
        const response = await handleFunctionRequest(request, pathname, () => ({
            ...process.env,
            img_d1: getD1(CloudflareD1),
            img_r2: getR2(CloudflareR2Storage),
        }));

        return sendNodeResponse(res, response || new Response('Not Found', { status: 404 }));
    } catch (error) {
        console.error('Vercel function error:', error);
        return sendNodeResponse(res, new Response(`Internal Server Error: ${error.message}`, { status: 500 }));
    }
}

function getD1(CloudflareD1) {
    if (!d1) d1 = new CloudflareD1();
    return d1;
}

function getR2(CloudflareR2Storage) {
    if (!r2) r2 = new CloudflareR2Storage();
    return r2;
}

function getOriginalPath(req) {
    const url = new URL(req.url, getOrigin(req));
    return url.searchParams.get('__cf_imgbed_path') || url.pathname;
}

function toWebRequest(req, pathname) {
    const incomingUrl = new URL(req.url, getOrigin(req));
    const url = new URL(pathname + incomingUrl.search, getOrigin(req));
    url.searchParams.delete('__cf_imgbed_path');

    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) {
            for (const item of value) headers.append(name, item);
        } else if (value !== undefined) {
            headers.set(name, value);
        }
    }

    if (!headers.get('x-real-ip')) {
        const forwardedFor = headers.get('x-forwarded-for');
        if (forwardedFor) headers.set('x-real-ip', forwardedFor.split(',')[0].trim());
    }

    const init = {
        method: req.method,
        headers,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        init.body = req;
        init.duplex = 'half';
    }

    return new Request(url.toString(), init);
}

async function sendNodeResponse(res, response) {
    res.statusCode = response.status;
    res.statusMessage = response.statusText;

    response.headers.forEach((value, name) => {
        res.setHeader(name, value);
    });

    if (!response.body) {
        res.end();
        return;
    }

    const reader = response.body.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
        }
    } finally {
        res.end();
        reader.releaseLock();
    }
}

function getOrigin(req) {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host || 'localhost';
    return `${proto}://${host}`;
}
