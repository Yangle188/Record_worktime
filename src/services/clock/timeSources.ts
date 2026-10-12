/**
 * 时间源 provider 接口与内置实现（TECH-DESIGN §6.2）。
 *
 * ⚠️ 对 PRD §4.1 / D-007 的实现偏离（TECH-DESIGN §14 D1）：
 * 「读取 HTTP `Date` 响应头」在浏览器中**不可行**——`Date` 不属于 CORS 安全列表响应头，
 * 跨域 JS 读 `response.headers.get('Date')` 只会拿到 `null`。
 * 因此内置源改为解析**响应体中的时间字段**；如需 `Date` 头（例如自建静态端点），
 * 用 `createDateHeaderSource()` 注册——该函数会在头不可读时明确报错。
 */

export type TimeSourceKind = 'jsonTimestamp' | 'textTimestamp' | 'dateHeader';

export interface TimeSource {
  id: string;
  label: string;
  kind: TimeSourceKind;
  url: string;
  /** 设置页展示用说明 */
  note: string;
  /** 解析服务端时间（epoch ms）；失败请抛错 */
  parse(response: Response): Promise<number>;
}

function createTimeapiSource(): TimeSource {
  return {
    id: 'timeapi-io',
    label: 'timeapi.io',
    kind: 'jsonTimestamp',
    url: 'https://timeapi.io/api/Time/current/zone?timeZone=UTC',
    note: '毫秒级精度，CORS 开放（主源）',
    async parse(response) {
      const payload = (await response.json()) as {
        year: number;
        month: number;
        day: number;
        hour: number;
        minute: number;
        seconds: number;
        milliSeconds?: number;
      };
      if (typeof payload.year !== 'number' || typeof payload.seconds !== 'number') {
        throw new Error('timeapi.io 响应字段缺失');
      }
      return Date.UTC(
        payload.year,
        payload.month - 1,
        payload.day,
        payload.hour,
        payload.minute,
        payload.seconds,
        payload.milliSeconds ?? 0,
      );
    },
  };
}

function createCloudflareTraceSource(): TimeSource {
  return {
    id: 'cloudflare-trace',
    label: 'Cloudflare trace',
    kind: 'textTimestamp',
    url: 'https://www.cloudflare.com/cdn-cgi/trace',
    note: '整秒精度，CORS 开放（兜底源）',
    async parse(response) {
      const text = await response.text();
      const match = /^ts=([\d.]+)$/m.exec(text);
      if (!match) throw new Error('Cloudflare trace 响应中缺少 ts 字段');
      return Math.round(Number(match[1]) * 1000);
    },
  };
}

/** 内置时间源，按优先级排列。 */
export const TIME_SOURCES: readonly TimeSource[] = [
  createTimeapiSource(),
  createCloudflareTraceSource(),
];

export function getTimeSource(id: string): TimeSource | undefined {
  return TIME_SOURCES.find((source) => source.id === id);
}

/** 把设置里保存的 id 列表解析为 provider；全部失效时回退到内置默认列表。 */
export function resolveTimeSources(ids: readonly string[]): TimeSource[] {
  const resolved = ids
    .map((id) => getTimeSource(id))
    .filter((source): source is TimeSource => source !== undefined);
  return resolved.length > 0 ? resolved : [...TIME_SOURCES];
}

/** 用于 M5 的自建静态 `/time` 端点：服务端 expose `Date` 头时可用。 */
export function createDateHeaderSource(id: string, label: string, url: string): TimeSource {
  return {
    id,
    label,
    kind: 'dateHeader',
    url,
    note: '需要服务端返回 Access-Control-Expose-Headers: Date',
    async parse(response) {
      const header = response.headers.get('Date');
      if (!header) throw new Error('Date 响应头不可跨域读取（需服务端 expose）');
      const parsed = Date.parse(header);
      if (Number.isNaN(parsed)) throw new Error('Date 响应头无法解析');
      return parsed;
    },
  };
}
