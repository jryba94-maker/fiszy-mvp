type RedisRestResponse<T> = {
  result?: T;
  error?: string;
};

function firstDefined(names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }

  return undefined;
}

function getRedisConfig() {
  const url = firstDefined([
    "STORAGE_KV_REST_API_URL",
    "KV_REST_API_URL",
    "UPSTASH_REDIS_REST_URL",
  ]);

  const token = firstDefined([
    "STORAGE_KV_REST_API_TOKEN",
    "KV_REST_API_TOKEN",
    "UPSTASH_REDIS_REST_TOKEN",
  ]);

  if (!url || !token) {
    throw new Error("Redis REST environment variables are missing.");
  }

  return { url, token };
}

export async function redisCommand<T>(command: Array<string | number>): Promise<T | null> {
  const { url, token } = getRedisConfig();

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Redis REST request failed with status ${response.status}.`);
  }

  const data = (await response.json()) as RedisRestResponse<T>;

  if (data.error) {
    throw new Error(data.error);
  }

  return data.result ?? null;
}
