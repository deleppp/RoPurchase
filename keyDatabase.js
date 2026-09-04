<<<<<<< HEAD
class KeyDatabase {
    constructor(redisClient) {
        this.redis = redisClient;
    }

    _parseData(rawData) {
        if (!rawData) return null;
        if (typeof rawData === 'object') return rawData;
        try {
            return JSON.parse(rawData);
        } catch (err) {
            console.error('❌ [ERROR] Failed to parse Redis JSON data:', err);
            return null;
        }
    }

    async saveKey(cleanKey, data) {
        const formattedKey = String(cleanKey).trim().toUpperCase();
        const keyData = {
            used: Boolean(data.used),
            expiresAt: data.expiresAt || (Date.now() + 72 * 3600 * 1000),
            player: data.player || data.Player || 'Unknown',
            userId: Number(data.userId || data.UserId || 0),
            hasGamepass: Boolean(data.hasGamepass ?? data.HasGamepass),
            redeemedByDiscordId: data.redeemedByDiscordId || null,
            rewardCode: data.rewardCode || null,
            rewardFileUrl: data.rewardFileUrl || data.rewardFile || null,
            rewardFileName: data.rewardFileName || null
        };
        await this.redis.set(`key:${formattedKey}`, JSON.stringify(keyData), { ex: 259200 });
        return keyData;
    }

    async fetchKey(rawKey) {
        if (!rawKey) return { targetKey: null, keyData: null };
        const cleanInput = String(rawKey).trim().toUpperCase();
        
        try {
            const rawData = await this.redis.get(`key:${cleanInput}`);
            if (rawData) {
                return { targetKey: cleanInput, keyData: this._parseData(rawData) };
            }
        } catch (err) {
            console.error('❌ [ERROR] Error fetching key data from Redis database module:', err);
        }
        return { targetKey: null, keyData: null };
    }

    async updateKey(targetKey, updatedData) {
        const formattedKey = String(targetKey).trim().toUpperCase();
        await this.redis.set(`key:${formattedKey}`, JSON.stringify(updatedData));
    }

    async totalKeysCount() {
        let cursor = 0;
        let count = 0;
        try {
            do {
                const res = await this.redis.scan(cursor, { match: 'key:*', count: 100 });
                if (!res) break;
                const nextCursor = res[0];
                const keys = res[1];
                cursor = Number(nextCursor);
                if (keys && Array.isArray(keys)) count += keys.length;
            } while (cursor !== 0);
        } catch (err) {
            console.error('❌ [ERROR] Failed to scan keys count:', err);
        }
        return count;
    }
}

=======
class KeyDatabase {
    constructor(redisClient) {
        this.redis = redisClient;
    }

    _parseData(rawData) {
        if (!rawData) return null;
        if (typeof rawData === 'object') return rawData;
        try {
            return JSON.parse(rawData);
        } catch (err) {
            console.error('❌ [ERROR] Failed to parse Redis JSON data:', err);
            return null;
        }
    }

    async saveKey(cleanKey, data) {
        const formattedKey = String(cleanKey).trim().toUpperCase();
        const keyData = {
            used: Boolean(data.used),
            expiresAt: data.expiresAt || (Date.now() + 72 * 3600 * 1000),
            player: data.player || data.Player || 'Unknown',
            userId: Number(data.userId || data.UserId || 0),
            hasGamepass: Boolean(data.hasGamepass ?? data.HasGamepass),
            redeemedByDiscordId: data.redeemedByDiscordId || null,
            rewardCode: data.rewardCode || null,
            rewardFileUrl: data.rewardFileUrl || data.rewardFile || null,
            rewardFileName: data.rewardFileName || null
        };
        await this.redis.set(`key:${formattedKey}`, JSON.stringify(keyData), { ex: 259200 });
        return keyData;
    }

    async fetchKey(rawKey) {
        if (!rawKey) return { targetKey: null, keyData: null };
        const cleanInput = String(rawKey).trim().toUpperCase();
        
        try {
            const rawData = await this.redis.get(`key:${cleanInput}`);
            if (rawData) {
                return { targetKey: cleanInput, keyData: this._parseData(rawData) };
            }
        } catch (err) {
            console.error('❌ [ERROR] Error fetching key data from Redis database module:', err);
        }
        return { targetKey: null, keyData: null };
    }

    async updateKey(targetKey, updatedData) {
        const formattedKey = String(targetKey).trim().toUpperCase();
        await this.redis.set(`key:${formattedKey}`, JSON.stringify(updatedData));
    }

    async totalKeysCount() {
        let cursor = 0;
        let count = 0;
        try {
            do {
                const res = await this.redis.scan(cursor, { match: 'key:*', count: 100 });
                if (!res) break;
                const nextCursor = res[0];
                const keys = res[1];
                cursor = Number(nextCursor);
                if (keys && Array.isArray(keys)) count += keys.length;
            } while (cursor !== 0);
        } catch (err) {
            console.error('❌ [ERROR] Failed to scan keys count:', err);
        }
        return count;
    }
}

>>>>>>> 5306ce94326d28dd2a110a423c6ac25e0950f9cd
module.exports = KeyDatabase;