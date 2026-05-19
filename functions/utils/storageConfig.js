import { getDatabase } from './databaseAdapter.js';
import { getUploadConfig } from '../api/manage/sysConfig/upload.js';

async function loadUploadConfig(env) {
    const db = getDatabase(env);
    return getUploadConfig(db, env);
}

export async function resolveTelegramConfig(env, metadata = {}) {
    try {
        const uploadConfig = await loadUploadConfig(env);
        const channels = uploadConfig.telegram?.channels || [];
        const channel = channels.find(item => item.name === metadata.ChannelName)
            || channels.find(item => item.chatId === metadata.TgChatId);

        if (channel?.botToken) {
            return channel;
        }
    } catch (error) {
        console.error('Failed to resolve Telegram channel config:', error);
    }

    if (metadata.TgBotToken) {
        return {
            botToken: metadata.TgBotToken,
            chatId: metadata.TgChatId || '',
            proxyUrl: metadata.TgProxyUrl || '',
        };
    }

    return null;
}

export async function resolveS3Config(env, metadata = {}) {
    try {
        const uploadConfig = await loadUploadConfig(env);
        const channels = uploadConfig.s3?.channels || [];
        const channel = channels.find(item => item.name === metadata.ChannelName)
            || channels.find(item =>
                item.endpoint === metadata.S3Endpoint
                && item.bucketName === metadata.S3BucketName
            );

        if (channel?.accessKeyId && channel?.secretAccessKey) {
            return channel;
        }
    } catch (error) {
        console.error('Failed to resolve S3 channel config:', error);
    }

    if (metadata.S3AccessKeyId && metadata.S3SecretAccessKey) {
        return {
            accessKeyId: metadata.S3AccessKeyId,
            secretAccessKey: metadata.S3SecretAccessKey,
            endpoint: metadata.S3Endpoint,
            bucketName: metadata.S3BucketName,
            region: metadata.S3Region,
            pathStyle: metadata.S3PathStyle,
            cdnDomain: metadata.S3CdnDomain || '',
        };
    }

    return null;
}

export async function resolveDiscordConfig(env, metadata = {}) {
    try {
        const uploadConfig = await loadUploadConfig(env);
        const channels = uploadConfig.discord?.channels || [];
        const channel = channels.find(item => item.name === metadata.ChannelName)
            || channels.find(item => item.channelId === metadata.DiscordChannelId);

        if (channel?.botToken) {
            return channel;
        }
    } catch (error) {
        console.error('Failed to resolve Discord channel config:', error);
    }

    if (metadata.DiscordBotToken) {
        return {
            botToken: metadata.DiscordBotToken,
            channelId: metadata.DiscordChannelId || '',
            proxyUrl: metadata.DiscordProxyUrl || '',
        };
    }

    return null;
}

export async function resolveHuggingFaceConfig(env, metadata = {}) {
    try {
        const uploadConfig = await loadUploadConfig(env);
        const channels = uploadConfig.huggingface?.channels || [];
        const channel = channels.find(item => item.name === metadata.ChannelName)
            || channels.find(item => item.repo === metadata.HfRepo);

        if (channel?.token) {
            return channel;
        }
    } catch (error) {
        console.error('Failed to resolve HuggingFace channel config:', error);
    }

    if (metadata.HfToken) {
        return {
            token: metadata.HfToken,
            repo: metadata.HfRepo,
            isPrivate: metadata.HfIsPrivate || false,
        };
    }

    return null;
}
